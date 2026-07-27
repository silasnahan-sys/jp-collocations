import { PluginSettingTab, Setting, Notice, Platform, requestUrl } from "obsidian";
import type { App } from "obsidian";
import { detectTools } from "../notes/audio-extractor.ts";
import { parsePlexSessions, plexSessionsUrl } from "../notes/plex.ts";
import { normalizeCookieInput, cookieValue, YtHistoryClient } from "../notes/yt-history-client.ts";
import { detectSpeechTools } from "../notes/voice-lab.ts";
import { USERSCRIPT_SOURCE } from "../x/mobile-capture.ts";
import type { Plugin } from "obsidian";
import type { PluginSettings, SpeakerFormat } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import type { HyogenScraper } from "../scraper/HyogenScraper.ts";

/** The slice of the plugin this tab calls back into (kept narrow to avoid a
 *  circular import of the concrete plugin class). */
type SettingsHost = Plugin & {
  convertBigDictionary?: () => Promise<string>;
  convertDexieBackup?: () => Promise<string>;
  repairBigDictionaries?: () => Promise<string>;
  listBigDictionaries?: () => Promise<Array<{
    title: string; headwords: number; frames: number; dir: string;
    partial: boolean; revision: string;
  }>>;
};

export class SettingsTab extends PluginSettingTab {
  private settings: PluginSettings;
  private store: CollocationStore;
  private getScraper: () => HyogenScraper | null;
  private onSettingsChange: () => Promise<void>;
  private host: SettingsHost;

  constructor(
    app: App,
    plugin: Plugin,
    settings: PluginSettings,
    store: CollocationStore,
    getScraper: () => HyogenScraper | null,
    onSettingsChange: () => Promise<void>
  ) {
    super(app, plugin);
    this.host = plugin as SettingsHost;
    this.settings = settings;
    this.store = store;
    this.getScraper = getScraper;
    this.onSettingsChange = onSettingsChange;
  }

  /**
   * The installed-dictionary receipt.
   *
   * A conversion that writes 2.36M headwords and then changes nothing visible
   * anywhere is indistinguishable from one that silently failed — which is how
   * a completely successful 英辞郎 run was actually read. This is the surface
   * that answers "did it work", and it answers it from the files themselves
   * rather than from a remembered result.
   *
   * Discovery reads one meta.json per folder, so the block paints a placeholder
   * and fills in. A dictionary whose meta is `partial` is shown as 暫定 and
   * never as a finished install (§12: machine output looks provisional).
   */
  private renderInstalledDictionaries(containerEl: HTMLElement): void {
    const wrap = containerEl.createDiv({ cls: "jpc-bigdict-installed" });
    wrap.createEl("h4", { text: "変換済みの辞書" });
    const list = wrap.createDiv({ cls: "jpc-bigdict-list" });
    list.createEl("p", { text: "読み込み中…", cls: "setting-item-description" });

    const paint = async (): Promise<void> => {
      list.empty();
      let dicts: Awaited<ReturnType<NonNullable<SettingsHost["listBigDictionaries"]>>> = [];
      try {
        dicts = (await this.host.listBigDictionaries?.()) ?? [];
      } catch (err) {
        list.createEl("p", {
          text: `辞書一覧を読めませんでした: ${String(err instanceof Error ? err.message : err)}`,
          cls: "setting-item-description",
        });
        return;
      }
      if (!dicts.length) {
        list.createEl("p", {
          text: "変換済みの辞書はまだありません。上のボタンで変換してください。"
            + "フォルダにシャード(head-000.jsonl など)があるのに表示されない場合は「修復」を押してください。",
          cls: "setting-item-description",
        });
        return;
      }
      const total = dicts.reduce((s, d) => s + d.headwords, 0);
      list.createEl("p", {
        text: `${dicts.length}辞書 ・ 見出し ${total.toLocaleString()}語`,
        cls: "setting-item-description",
      });
      for (const d of dicts) {
        const row = list.createDiv({ cls: "jpc-bigdict-row" });
        const name = row.createDiv({ cls: "jpc-bigdict-name" });
        name.createSpan({ text: d.title });
        if (d.partial) name.createSpan({ text: "暫定", cls: "jpc-bigdict-partial" });
        row.createDiv({
          cls: "jpc-bigdict-count",
          text: `${d.headwords.toLocaleString()}語 / ${d.frames.toLocaleString()}フレーム`,
        });
      }
      if (dicts.some((d) => d.partial)) {
        list.createEl("p", {
          text: "「暫定」＝ 変換が最後まで終わったか確認できない辞書です（変換中、または修復で復元したもの）。"
            + "検索はそのまま使えます。",
          cls: "setting-item-description",
        });
      }
    };

    new Setting(wrap)
      .setName("見つからない辞書を修復")
      .setDesc("シャードはあるのに meta.json が無いフォルダを探して作り直します（中断した変換の復旧）。")
      .addButton(b => b
        .setButtonText("修復")
        .onClick(async () => {
          b.setDisabled(true).setButtonText("修復中…");
          try { await this.host.repairBigDictionaries?.(); await paint(); }
          finally { b.setDisabled(false).setButtonText("修復"); }
        }))
      .addButton(b => b
        .setButtonText("再読み込み")
        .onClick(async () => { await paint(); }));

    void paint();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "JP Collocations Settings" });

    // ── Hyogen Scraper ─────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Hyogen Scraper" });

    new Setting(containerEl)
      .setName("Enable Hyogen scraping")
      .setDesc("Allow fetching from collocation.hyogen.info")
      .addToggle(t => t.setValue(this.settings.hyogenEnabled).onChange(async v => {
        this.settings.hyogenEnabled = v;
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("Rate limit (ms)")
      .setDesc("Minimum milliseconds between requests (default: 2000)")
      .addSlider(s => s.setLimits(1000, 10000, 500).setValue(this.settings.hyogenRateLimit)
        .setDynamicTooltip().onChange(async v => {
          this.settings.hyogenRateLimit = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Word list to scrape")
      .setDesc("Comma-separated list of Japanese words to fetch from Hyogen")
      .addTextArea(t => {
        t.setValue(this.settings.hyogenWordList.join(", ")).onChange(async v => {
          this.settings.hyogenWordList = v.split(",").map(w => w.trim()).filter(Boolean);
          await this.onSettingsChange();
        });
        t.inputEl.rows = 3;
      });

    // ── TWC Scraper ────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "筑波ウェブコーパス (TWC)" });

    new Setting(containerEl)
      .setName("Enable TWC lookup")
      .setDesc("Fetch collocation profiles from Tsukuba Web Corpus (研究・教育目的のみ)")
      .addToggle(t => t.setValue(this.settings.twcEnabled).onChange(async v => {
        this.settings.twcEnabled = v;
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("TWC rate limit (ms)")
      .setDesc("Minimum milliseconds between TWC requests (default: 3000)")
      .addSlider(s => s.setLimits(2000, 15000, 500).setValue(this.settings.twcRateLimit)
        .setDynamicTooltip().onChange(async v => {
          this.settings.twcRateLimit = v;
          await this.onSettingsChange();
        }));

    // ── X (Twitter) Search ─────────────────────────────────────────
    containerEl.createEl("h3", { text: "X (Twitter) 検索辞書" });
    containerEl.createEl("p", {
      text: "ログイン中の x.com から auth_token と ct0 クッキーを貼り付けてください（端末内のみ保存）。" +
        "詳細はサイドバーの 𝕏 ビューの 🔑 からも設定できます。非公式エンドポイントを使うため、ToS とレート制限にご注意ください。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("ライブ取得を有効化")
      .setDesc("オフにするとキャッシュ済みコーパスのみで検索します")
      .addToggle(t => t.setValue(this.settings.x.enabled).onChange(async v => {
        this.settings.x.enabled = v;
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("auth_token クッキー")
      .addText(t => {
        t.setValue(this.settings.x.authToken).onChange(async v => {
          this.settings.x.authToken = v.trim();
          await this.onSettingsChange();
        });
        t.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("ct0 (csrf) クッキー")
      .addText(t => {
        t.setValue(this.settings.x.csrfToken).onChange(async v => {
          this.settings.x.csrfToken = v.trim();
          await this.onSettingsChange();
        });
        t.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("既定の言語フィルタ")
      .setDesc("新規検索の lang:（空欄で全言語）")
      .addText(t => t.setValue(this.settings.x.defaultLang).onChange(async v => {
        this.settings.x.defaultLang = v.trim();
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("既定のタブ")
      .addDropdown(d => {
        d.addOption("Latest", "最新");
        d.addOption("Top", "話題");
        d.addOption("Media", "メディア");
        d.setValue(this.settings.x.defaultProduct).onChange(async v => {
          this.settings.x.defaultProduct = v as PluginSettings["x"]["defaultProduct"];
          await this.onSettingsChange();
        });
      });

    new Setting(containerEl)
      .setName("1ページの取得件数")
      .addSlider(s => s.setLimits(10, 100, 10).setValue(this.settings.x.resultLimit)
        .setDynamicTooltip().onChange(async v => {
          this.settings.x.resultLimit = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("ノート書き出しフォルダ")
      .setDesc("ツイートをノート化する Vault フォルダ（プラグインが自動索引）")
      .addText(t => t.setValue(this.settings.x.exportFolder).onChange(async v => {
        this.settings.x.exportFolder = v.trim() || "X Tweets";
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("コレクションフォルダ")
      .setDesc("📚 で追加する先。テーマ別ノート（哲学.md / 筋トレ.md …）を置く Vault フォルダ")
      .addText(t => t.setValue(this.settings.x.collectionsFolder).onChange(async v => {
        this.settings.x.collectionsFolder = v.trim() || "JP Collections";
        await this.onSettingsChange();
      }));

    // ── iOS co-occurrence lookup (Orion userscript) ────────────────
    const xMobile = containerEl.createEl("details");
    xMobile.createEl("summary", { text: "iOS 共起チェック（Orion ユーザースクリプト）" });
    xMobile.createEl("p", {
      text:
        "iPhone/iPad で「この2語、一緒に使われてる?」を即チェックする経路。x.com の SPA は埋め込み" +
        "WebView では動かないため、ログイン済みの実ブラウザ Orion で検索を開き、ユーザースクリプトが" +
        "結果を自動取得して Obsidian に戻します。X の署名(anti-bot)を回避でき、確実に新着を取得できます。",
      cls: "setting-item-description",
    });
    xMobile.createEl("p", {
      text:
        "セットアップ: ① Orion を既定ブラウザに設定（設定→アプリ→Orion→デフォルトのブラウザApp）→ " +
        "② 下のボタンでユーザースクリプトをコピー → ③ Orion にユーザースクリプト管理（Violentmonkey 等、" +
        "または Orion 内蔵のユーザースクリプト）で新規作成し貼り付け → ④ Orion で x.com に一度ログイン。" +
        "以降は Obsidian のコマンド「X 共起チェック（モバイル）」で、2語をコピー(or 選択)して実行するだけ。",
      cls: "setting-item-description",
    });

    new Setting(xMobile)
      .setName("ユーザースクリプトを書き出す / コピー")
      .setDesc("Vault 直下に JP-X-Cooc.user.js を作成し、内容をクリップボードにもコピーします")
      .addButton(b => b.setButtonText("Vault に書き出す").onClick(async () => {
        const name = "JP-X-Cooc.user.js";
        try {
          await this.app.vault.adapter.write(name, USERSCRIPT_SOURCE);
          new Notice(`書き出しました: ${name}`);
        } catch (e) {
          new Notice(`書き出し失敗: ${(e as Error).message}`, 6000);
        }
      }))
      .addButton(b => b.setButtonText("コピー").onClick(async () => {
        try {
          await navigator.clipboard.writeText(USERSCRIPT_SOURCE);
          new Notice("ユーザースクリプトをコピーしました");
        } catch {
          new Notice("コピーできませんでした", 5000);
        }
      }));

    const xAdv = containerEl.createEl("details");
    xAdv.createEl("summary", { text: "詳細（X が仕様変更した時のみ）" });
    new Setting(xAdv)
      .setName("SearchTimeline queryId")
      .setDesc("検索が 404/失敗する時はブラウザの devtools から最新値を取得")
      .addText(t => t.setValue(this.settings.x.searchQueryId).onChange(async v => {
        this.settings.x.searchQueryId = v.trim();
        await this.onSettingsChange();
      }));
    new Setting(xAdv)
      .setName("Bearer token")
      .addText(t => t.setValue(this.settings.x.bearerToken).onChange(async v => {
        this.settings.x.bearerToken = v.trim();
        await this.onSettingsChange();
      }));
    new Setting(xAdv)
      .setName("Features JSON")
      .setDesc("GraphQL feature フラグ。X のエラーが要求するキーをここで調整")
      .addTextArea(t => {
        t.setValue(this.settings.x.featuresJson).onChange(async v => {
          this.settings.x.featuresJson = v.trim();
          await this.onSettingsChange();
        });
        t.inputEl.rows = 4;
        t.inputEl.style.width = "100%";
      });

    // ── Audio clips (yt-dlp) — DESKTOP ONLY, DESIGN §12 Tier 1 ─────
    // ── §27.5 big dictionaries as vault sidecars ──────────────────────────
    containerEl.createEl("h3", { text: "大型辞書（英辞郎など）— デスクトップ限定" });
    if (!this.settings.bigDict) this.settings.bigDict = { exportFolder: "", root: "JP Dictionaries", backupFile: "" };
    const big = this.settings.bigDict;
    if (!Platform.isDesktopApp) {
      containerEl.createEl("p", {
        text: "変換はデスクトップ版でのみ実行できます（モバイルには Node がありません）。変換済みの辞書はモバイルでも読めます。",
        cls: "setting-item-description",
      });
    }
    const bigDesc = containerEl.createEl("p", { cls: "setting-item-description" });
    bigDesc.innerHTML =
      "英辞郎（236万語）のような巨大辞書は、プラグインのデータ blob に入れると起動のたびに全体が読み書きされます。" +
      "代わりに<b>金庫内のシャードJSONL</b>へ変換します — 1回の検索で読むファイルは1つだけ、索引ファイルはありません。<br>" +
      "Yomitan書き出しZIPを<b>展開したフォルダ</b>（index.json と term_bank_*.json がある場所）を指定してください。" +
      "ZIPは金庫の外に置いたままで構いません（展開後 522MB を同期する必要はありません）。";

    new Setting(containerEl)
      .setName("Yomitan書き出しフォルダ（展開済み）")
      .setDesc("例: C:/Users/…/eijiro-yomitan  ── index.json を含むフォルダ")
      .addText(t => t
        .setPlaceholder("/path/to/extracted-export")
        .setValue(big.exportFolder)
        .onChange(async v => { big.exportFolder = v.trim(); await this.onSettingsChange(); }));

    new Setting(containerEl)
      .setName("変換先フォルダ（金庫内）")
      .setDesc("シャードの置き場所。フォルダごと削除すればアンインストールになります。")
      .addText(t => t
        .setValue(big.root)
        .onChange(async v => { big.root = v.trim() || "JP Dictionaries"; await this.onSettingsChange(); }));

    // ── the OTHER path: Yomitan's single all-dictionaries backup ──
    const backupDesc = containerEl.createEl("p", { cls: "setting-item-description" });
    backupDesc.innerHTML =
      "上は<b>1辞書ずつ</b>のZIP書き出し用です。Yomitanの「すべてバックアップ」で作った<b>1つの巨大JSON</b>" +
      "（実測 12.7GB・36辞書・401万語）はこちらから。ファイル全体は読み込まず流し読みします — " +
      "実測 185秒・ピークメモリ1MB未満。<br>" +
      "登録済み36辞書のみを変換します（terms表には削除済み辞書の残骸が97種類ぶん残っており、" +
      "そのまま変換すると不要なフォルダが61個できます）。";

    new Setting(containerEl)
      .setName("Yomitanバックアップ(.json)")
      .setDesc("例: C:/Users/…/yomitan-dictionaries-….json")
      .addText(t => t
        .setPlaceholder("/path/to/yomitan-dictionaries-….json")
        .setValue(big.backupFile)
        .onChange(async v => { big.backupFile = v.trim(); await this.onSettingsChange(); }));

    new Setting(containerEl)
      .setName("バックアップから全辞書を変換")
      .setDesc("1回の流し読みで36辞書ぶんのシャードを作ります。時間がかかります（実測3分）。")
      .addButton(b => b
        .setButtonText("全辞書を変換")
        .setDisabled(!Platform.isDesktopApp)
        .onClick(async () => {
          b.setDisabled(true).setButtonText("変換中…");
          try { await this.host.convertDexieBackup?.(); }
          finally { b.setDisabled(false).setButtonText("全辞書を変換"); }
        }));

    new Setting(containerEl)
      .setName("辞書を変換")
      .setDesc("コマンド「辞書: Convert Yomitan Export → Vault Sidecars」と同じ。再実行すると作り直します。")
      .addButton(b => b
        .setButtonText("変換を実行")
        .setDisabled(!Platform.isDesktopApp)
        .onClick(async () => {
          b.setDisabled(true).setButtonText("変換中…");
          try { await this.host.convertBigDictionary?.(); }
          finally { b.setDisabled(false).setButtonText("変換を実行"); }
        }));

    // ── What is actually installed ────────────────────────────────────────
    // A conversion that writes 2.36M headwords and then shows nothing anywhere
    // is indistinguishable from one that did nothing — which is exactly how a
    // fully successful 英辞郎 run was read. The list is the receipt.
    this.renderInstalledDictionaries(containerEl);

    containerEl.createEl("h3", { text: "音声クリップ (yt-dlp) — デスクトップ限定" });
    const audio = this.settings.audioExtraction;
    if (!Platform.isDesktopApp) {
      containerEl.createEl("p", {
        text: "この機能はデスクトップ版 Obsidian でのみ動作します（モバイルには child_process がありません）。",
        cls: "setting-item-description",
      });
    }
    const audioDesc = containerEl.createEl("p", { cls: "setting-item-description" });
    audioDesc.innerHTML =
      "照合スパンの時刻から、その一瞬だけの MP3 クリップを取得してカードに埋め込みます（Anki 方式）。<br>" +
      "<b>要インストール:</b> yt-dlp・ffmpeg・JS ランタイム(deno か node)。" +
      "<b>注意:</b> YouTube 音声のダウンロードは ToS のグレーゾーンです。本プラグインはダウンローダを同梱・自動インストールしません（個人利用の範囲で自己責任）。";

    new Setting(containerEl)
      .setName("音声クリップ取得を有効化")
      .setDesc("オプトイン。オフの間はタイムスタンプの深リンク(youtu.be?t=)のみ。")
      .addToggle(t => t.setValue(audio.enabled).onChange(async v => {
        audio.enabled = v;
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("保存フォルダ")
      .setDesc("クリップ (clip_<id>_<秒>.mp3) の出力先（vault 相対）。")
      .addText(t => t.setValue(audio.outputFolder).setPlaceholder("JP Audio Clips").onChange(async v => {
        audio.outputFolder = v.trim() || "JP Audio Clips";
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("クリップ長 (秒)")
      .setDesc("終了時刻が無いスパンで使う長さ。")
      .addSlider(s => s.setLimits(4, 40, 1).setValue(audio.clipLengthSec).setDynamicTooltip()
        .onChange(async v => { audio.clipLengthSec = v; await this.onSettingsChange(); }));

    new Setting(containerEl)
      .setName("リード秒 (前)")
      .setDesc("開始の少し前から録るための余白（内容のみ。ファイル名は開始秒基準）。")
      .addSlider(s => s.setLimits(0, 10, 1).setValue(audio.preRollSec).setDynamicTooltip()
        .onChange(async v => { audio.preRollSec = v; await this.onSettingsChange(); }));

    new Setting(containerEl)
      .setName("音声フォーマット")
      .addDropdown(d => {
        d.addOption("mp3", "mp3 (Obsidian 再生対応)");
        d.addOption("m4a", "m4a");
        d.addOption("opus", "opus");
        d.setValue(audio.audioFormat).onChange(async v => {
          audio.audioFormat = v as typeof audio.audioFormat;
          await this.onSettingsChange();
        });
      });

    // Tool paths (auto-detect fills these; blanks fall back to PATH / auto).
    const status = containerEl.createEl("p", { cls: "setting-item-description" });
    const renderStatus = (msg: string) => { status.setText(msg); };
    renderStatus("パス未検出。「自動検出」を押すか、下の欄に手入力してください。");

    let ytComp: { setValue(v: string): unknown } | null = null;
    let ffComp: { setValue(v: string): unknown } | null = null;
    let jsComp: { setValue(v: string): unknown } | null = null;
    new Setting(containerEl)
      .setName("yt-dlp パス")
      .setDesc("空欄なら PATH の 'yt-dlp' を使用。")
      .addText(t => { ytComp = t; t.setValue(audio.ytdlpPath).setPlaceholder("yt-dlp").onChange(async v => {
        audio.ytdlpPath = v.trim(); await this.onSettingsChange();
      }); });
    new Setting(containerEl)
      .setName("ffmpeg ディレクトリ/バイナリ")
      .setDesc("空欄なら PATH。winget 版は自動検出できます。")
      .addText(t => { ffComp = t; t.setValue(audio.ffmpegPath).setPlaceholder("(auto)").onChange(async v => {
        audio.ffmpegPath = v.trim(); await this.onSettingsChange();
      }); });
    new Setting(containerEl)
      .setName("JS ランタイム")
      .setDesc("空欄なら deno を自動使用。node の場合 'node:C:\\\\Program Files\\\\nodejs\\\\node.exe' の形式。")
      .addText(t => { jsComp = t; t.setValue(audio.jsRuntime).setPlaceholder("(deno auto)").onChange(async v => {
        audio.jsRuntime = v.trim(); await this.onSettingsChange();
      }); });

    new Setting(containerEl)
      .setName("ツールを自動検出")
      .setDesc("yt-dlp・ffmpeg・JS ランタイムを探して上の欄を埋めます。")
      .addButton(b => b.setButtonText("自動検出").setCta().onClick(async () => {
        if (!Platform.isDesktopApp) { new Notice("デスクトップ版のみ"); return; }
        try {
          const d = detectTools();
          if (d.ytdlp) audio.ytdlpPath = d.ytdlp;
          if (d.ffmpeg) audio.ffmpegPath = d.ffmpeg;
          if (d.jsRuntime) audio.jsRuntime = d.jsRuntime;
          await this.onSettingsChange();
          renderStatus(
            `yt-dlp: ${d.ytdlp || "(PATH)"}\nffmpeg: ${d.ffmpeg || "(PATH)"}\nJS: ${d.jsRuntime || "(deno auto)"}\n— ${d.notes.join(" / ")}`,
          );
          ytComp?.setValue(audio.ytdlpPath);
          ffComp?.setValue(audio.ffmpegPath);
          jsComp?.setValue(audio.jsRuntime);
          new Notice("検出しました");
        } catch (e) {
          renderStatus(`検出失敗: ${String(e)}`);
        }
      }));

    // ── Plex / TV co-viewing (DESIGN §25.4 — clock (b) + clips) ───
    containerEl.createEl("h3", { text: "Plex / TV 連携（鑑賞モード）" });
    const plex = this.settings.plex;
    const plexDesc = containerEl.createEl("p", { cls: "setting-item-description" });
    plexDesc.innerHTML =
      "鑑賞モードのトランスクリプトを Plex の再生位置に自動同期します（clock (b)）。<br>" +
      "サーバーURL と X-Plex-Token を設定すると、鑑賞モードのヘッダーに「📺 Plex同期」が出ます。<br>" +
      "デブリーフのマークの 🎬 で、その瞬間の音声クリップ＋静止画を Part から切り出します（ffmpeg、デスクトップ限定）。<br>" +
      "<b>トークンは端末内のみ（同期される blob には保存されません）。</b>";

    new Setting(containerEl)
      .setName("サーバー URL")
      .setDesc("例: http://192.168.1.20:32400 — この端末から LAN で到達できること。")
      .addText(t => t.setValue(plex.baseUrl).setPlaceholder("http://…:32400").onChange(async v => {
        plex.baseUrl = v.trim(); await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("X-Plex-Token")
      .setDesc("秘密。端末内 localStorage に保存され、vault の blob には書き込まれません。")
      .addText(t => {
        t.setValue(plex.token).setPlaceholder("token").onChange(async v => {
          plex.token = v.trim(); await this.onSettingsChange();
        });
        t.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("クリップの前後余白 (秒)")
      .setDesc("マーク時刻の前後に何秒足して切り出すか。")
      .addSlider(s => s.setLimits(0, 15, 1).setValue(plex.clipPreSec).setDynamicTooltip()
        .onChange(async v => { plex.clipPreSec = v; plex.clipPostSec = v; await this.onSettingsChange(); }));

    new Setting(containerEl)
      .setName("接続テスト")
      .setDesc("/status/sessions を叩いて、今 Plex で再生中の項目を表示します（フィールド名の実地確認に）。")
      .addButton(b => b.setButtonText("テスト").onClick(async () => {
        if (!plex.baseUrl.trim() || !plex.token.trim()) { new Notice("サーバーURL と トークンを入力してください。"); return; }
        let resp;
        try {
          resp = await requestUrl({ url: plexSessionsUrl(plex.baseUrl, plex.token), method: "GET", headers: { Accept: "application/json" }, throw: false });
        } catch (e) { new Notice(`Plex 接続失敗: ${(e as Error).message}`, 8000); return; }
        const res = parsePlexSessions(resp.status, resp.text ?? "");
        if (!res.ok) { new Notice(`Plex: ${res.error}`, 8000); return; }
        if (!res.sessions.length) { new Notice("Plex: 接続OK — 再生中の項目はありません。", 6000); return; }
        new Notice("Plex 接続OK:\n" + res.sessions.map(s => `${s.paused ? "⏸" : "▶"} ${s.title} @${Math.floor(s.viewOffsetSec)}s`).join("\n"), 9000);
      }));

    // ── Transcript + history ingestion (DESIGN §8 Step 2) ─────────
    containerEl.createEl("h3", { text: "文字起こし取得（YouTube）" });
    const notes = this.settings.notes;
    const notesDesc = containerEl.createEl("p", { cls: "setting-item-description" });
    notesDesc.innerHTML =
      "動画の字幕を取得して「原文」ノートとして凍結し、メモを照合します。<br>" +
      "<b>デスクトップ:</b> yt-dlp 経由が確実（YouTube の JS チャレンジを解いて字幕を取得）。" +
      "<b>モバイル:</b> HTTP 直取得（PO トークンで空になる場合は手動貼り付けにフォールバック）。";

    new Setting(containerEl)
      .setName("保存フォルダ（文字起こし）")
      .setDesc("取得した字幕ノートの出力先（vault 相対）。")
      .addText(t => t.setValue(notes.transcriptFolder).setPlaceholder("Transcripts").onChange(async v => {
        notes.transcriptFolder = v.trim() || "Transcripts";
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("字幕の言語（優先順）")
      .setDesc("カンマ区切り。例: ja,en。最初に見つかった言語を使用。")
      .addText(t => t.setValue(notes.langPref).setPlaceholder("ja").onChange(async v => {
        notes.langPref = v.trim() || "ja";
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("手動字幕を優先")
      .setDesc("人手の字幕があれば自動字幕(ASR)より優先。")
      .addToggle(t => t.setValue(notes.preferManual).onChange(async v => {
        notes.preferManual = v; await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("yt-dlp で字幕取得（推奨・デスクトップ）")
      .setDesc("上の音声クリップ設定の yt-dlp/JS ランタイムのパスを共用します。")
      .addToggle(t => t.setValue(notes.useYtdlpTranscripts).onChange(async v => {
        notes.useYtdlpTranscripts = v; await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("履歴取得の上限（本）")
      .setDesc("視聴履歴の一括取得で処理する最大動画数。")
      .addSlider(s => s.setLimits(1, 100, 1).setValue(notes.maxHistoryVideos).setDynamicTooltip()
        .onChange(async v => { notes.maxHistoryVideos = v; await this.onSettingsChange(); }));

    // ── VoiceSync (whisper + speaker diarization) ─────────────────
    containerEl.createEl("h3", { text: "VoiceSync（話者同期・ローカル解析）" });
    const vs = this.settings.voiceSync;
    const vsDesc = containerEl.createEl("p", { cls: "setting-item-description" });
    vsDesc.innerHTML =
      "音声クリップをローカルで再解析: <b>whisper.cpp</b>（きれいな日本語＋トークン単位のタイムスタンプ）＋ <b>sherpa-onnx</b>（話者分離・相槌/割り込み検出）。" +
      "カードに<b>話者カラーのカラオケ・プレーヤー</b>（単語ハイライト・クリックでシーク）が埋め込まれます。すべてオフライン・無料。<br>" +
      "<b>必要ツール</b>（1回だけ配置。既定の場所: <code>%LOCALAPPDATA%\\jp-collocations\\speech-tools\\</code>）: " +
      "whisper.cpp の <code>whisper-blas-bin-x64.zip</code> → <code>whisper/</code> に展開、モデル <code>models/ggml-small.bin</code>、" +
      "sherpa-onnx の <code>win-x64-static-MT-Release-no-tts</code> ビルド、<code>sherpa-onnx-pyannote-segmentation-3-0/model.onnx</code>、<code>models/3dspeaker_embed.onnx</code>。";

    new Setting(containerEl)
      .setName("VoiceSync を有効化")
      .setDesc("クリップ取得時に自動で解析し、カードに話者同期プレーヤーを埋め込みます（1クリップ ≈ 20秒 CPU）。")
      .addToggle(t => t.setValue(vs.enabled).onChange(async v => {
        vs.enabled = v; await this.onSettingsChange();
      }));

    for (const p of vs.profiles) {
      new Setting(containerEl)
        .setName(`🗣 ${p.name}`)
        .setDesc(`登録済みの声（${p.durSec.toFixed(1)}s）— ${p.refWav}`)
        .addButton(b => b.setButtonText("削除").setWarning().onClick(async () => {
          vs.profiles = vs.profiles.filter(x => x.name !== p.name);
          await this.onSettingsChange();
          this.display();
        }));
    }

    new Setting(containerEl)
      .setName("話者分離の感度")
      .setDesc("低いほど多くの声を検出（合体しにくいが分裂しやすい）。既定 0.55 — 別人の声の混入を優先的に防ぎます。")
      .addSlider(s => s.setLimits(0.4, 0.9, 0.05).setValue(vs.clusterThreshold || 0.55).setDynamicTooltip()
        .onChange(async v => { vs.clusterThreshold = v; await this.onSettingsChange(); }));

    new Setting(containerEl)
      .setName("ツールフォルダ")
      .setDesc("空 = 既定（%LOCALAPPDATA%\\jp-collocations\\speech-tools）。")
      .addText(t => t.setValue(vs.toolsDir).setPlaceholder("(既定)").onChange(async v => {
        vs.toolsDir = v.trim(); await this.onSettingsChange();
      }))
      .addButton(b => b.setButtonText("ツール検出").onClick(() => {
        const tools = detectSpeechTools(vs.toolsDir);
        new Notice(tools.ready
          ? "✅ すべてのツールを検出しました。"
          : `未検出: ${[!tools.whisperCli && "whisper-cli", !tools.whisperModel && "whisper モデル", !tools.diarBin && "sherpa-onnx 話者分離", !tools.segModel && "segmentation モデル", !tools.embModel && "embedding モデル"].filter(Boolean).join(", ")}`, 10000);
      }));

    // ── Handwriting OCR (Claude vision) ───────────────────────────
    containerEl.createEl("h3", { text: "手書きOCR（Claude API）" });
    const ocrDesc = containerEl.createEl("p", { cls: "setting-item-description" });
    ocrDesc.innerHTML =
      "Apple Pencil などの手書きメモの<b>写真/スクリーンショット</b>をノートに埋め込み、コマンド「OCR Handwritten Note Images + Reconcile」を実行すると、" +
      "Claude が語句を<b>書かれている通りに</b>抽出してノートに追記し、そのまま文字起こしと照合します（誤字の校正は照合側が行います）。<br>" +
      "文字起こし本文が API に送られることはありません（画像とプロンプトのみ）。キーは X の Cookie と同様にプラグイン設定内に保存されます。" +
      "キーの発行: <a href='https://console.anthropic.com/'>console.anthropic.com</a>";

    new Setting(containerEl)
      .setName("Anthropic API キー")
      .setDesc("sk-ant-…（空 = OCR 無効）")
      .addText(t => {
        t.inputEl.type = "password";
        t.setValue(notes.ocrApiKey).setPlaceholder("sk-ant-…").onChange(async v => {
          notes.ocrApiKey = v.trim();
          await this.onSettingsChange();
        });
      });

    new Setting(containerEl)
      .setName("OCR モデル（上書き）")
      .setDesc("空 = 既定の Haiku（安価・1ページ ≈ 1,600 画像トークン）。")
      .addText(t => t.setValue(notes.ocrModel).setPlaceholder("claude-haiku-4-5-20251001").onChange(async v => {
        notes.ocrModel = v.trim();
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("エスカレーション モデル（上書き）")
      .setDesc("低確信・解析失敗時に1回だけ使う上位モデル。空 = 既定の Opus。")
      .addText(t => t.setValue(notes.ocrEscalationModel).setPlaceholder("claude-opus-4-8").onChange(async v => {
        notes.ocrEscalationModel = v.trim();
        await this.onSettingsChange();
      }));

    // ── Live watch history (cookie auth) ──────────────────────────
    containerEl.createEl("h3", { text: "視聴履歴（Cookie）— 期間指定で取得" });
    const hist = this.settings.ytHistory;
    const histDesc = containerEl.createEl("p", { cls: "setting-item-description" });
    histDesc.innerHTML =
      "youtube.com のログイン Cookie を<b>一度だけ</b>貼り付けると、「視聴日の範囲」を指定してサーバー側の視聴履歴（全デバイス）を取得できます。X 機能と同じ方式。" +
      "この Cookie は<b>音声クリップ取得・字幕取得</b>でも自動的に使われます（YouTube の「ロボットではないことを確認」壁を通過）。<br>" +
      "<b>いちばん簡単:</b> youtube.com にログイン → DevTools(F12) → Network → 任意のリクエストを右クリック → <b>Copy → Copy as cURL</b> → その内容を丸ごと下に貼り付け（Cookie を自動抽出します）。<br>" +
      "<b>⚠ 長持ちさせるコツ:</b> 通常ウィンドウの Cookie はブラウザ側で頻繁にローテーションされ、貼り付けたものが数時間で失効することがあります。" +
      "<b>シークレット/InPrivate ウィンドウ</b>で youtube.com にログイン → Cookie をコピー → <b>そのウィンドウを閉じる</b>と、ローテーションが止まり長く使えます（yt-dlp 公式の推奨手順）。<br>" +
      "貼り付け後、コマンド「Reconciliation Health Check」で接続を確認できます（失効時は再貼り付け）。";

    const cookieStatus = containerEl.createEl("p", { cls: "setting-item-description" });
    const renderCookieStatus = () => {
      const norm = normalizeCookieInput(hist.cookie);
      if (!norm) { cookieStatus.setText("未設定。"); return; }
      const hasSap = !!(cookieValue(norm, "SAPISID") || cookieValue(norm, "__Secure-3PAPISID"));
      const nCookies = norm.split(";").filter(s => s.includes("=")).length;
      cookieStatus.setText(hasSap
        ? `✅ Cookie を認識（${nCookies}個、SAPISID あり）。Health Check で接続確認できます。`
        : `⚠ SAPISID が見つかりません（${nCookies}個検出）。フル Cookie か Copy as cURL を貼り付けてください。`);
    };

    new Setting(containerEl)
      .setName("YouTube Cookie / cURL")
      .setDesc("フル cookie ヘッダ、または『Copy as cURL』の内容を貼り付け。秘密情報として保存されます。")
      .addTextArea(t => {
        t.setValue(hist.cookie).setPlaceholder("curl 'https://www.youtube.com/...' -H 'cookie: ...'  （またはフル cookie 文字列）").onChange(async v => {
          // Store the normalized cookie so the field reflects exactly what's used.
          hist.cookie = normalizeCookieInput(v);
          renderCookieStatus();
          await this.onSettingsChange();
        });
        t.inputEl.rows = 4;
        t.inputEl.style.width = "100%";
      });
    renderCookieStatus();

    // ── channel picker: one Google login can carry several YouTube channels
    //    (brand accounts), EACH with its own watch history ─────────────────
    new Setting(containerEl)
      .setName("チャンネル（ブランドアカウント）")
      .setDesc(hist.pageId
        ? `現在: ${hist.pageLabel || hist.pageId} — このチャンネルの視聴履歴を読みます。`
        : "現在: メインチャンネル。JP用など別チャンネルで視聴している場合、履歴はチャンネルごとに別なので下から選択してください。")
      .addButton(b => b.setButtonText("チャンネル一覧を取得").onClick(async () => {
        b.setDisabled(true);
        try {
          const http = {
            post: async (url: string, body: string, headers: Record<string, string>) => {
              const r = await requestUrl({ url, method: "POST", body, headers, throw: false });
              return { status: r.status, text: r.text ?? "" };
            },
            get: async () => ({ status: 500, text: "" }),
          };
          const client = new YtHistoryClient(http, () => hist);
          const accounts = await client.listAccounts();
          if (!accounts.length) { new Notice("チャンネルが見つかりませんでした（Cookie を確認）。"); return; }
          channelListEl.empty();
          for (const a of accounts) {
            const current = hist.pageId === (a.pageId ?? "");
            new Setting(channelListEl)
              .setName(`${a.name} ${a.handle}`.trim())
              .setDesc(a.pageId ? `pageId: ${a.pageId}` : "メイン（既定）")
              .addButton(bb => bb
                .setButtonText(current ? "✓ 選択中" : "このチャンネルを使う")
                .setDisabled(current)
                .onClick(async () => {
                  hist.pageId = a.pageId ?? "";
                  hist.pageLabel = `${a.name} ${a.handle}`.trim();
                  await this.onSettingsChange();
                  new Notice(`視聴履歴のチャンネル: ${hist.pageLabel}`);
                  this.display();
                }));
          }
        } catch (e) {
          new Notice(`チャンネル一覧の取得に失敗: ${(e as Error).message ?? e}`, 10000);
        } finally { b.setDisabled(false); }
      }));
    const channelListEl = containerEl.createDiv();

    new Setting(containerEl)
      .setName("INNERTUBE API キー（上級）")
      .setDesc("通常は既定のままで可。ローテートした場合のみ変更。")
      .addText(t => t.setValue(hist.apiKey).setPlaceholder("AIza...").onChange(async v => {
        hist.apiKey = v.trim() || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"; await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("クライアントバージョン（上級）")
      .setDesc("WEB クライアントのバージョン。空エラー時に更新。")
      .addText(t => t.setValue(hist.clientVersion).setPlaceholder("2.2024xxxx.xx.xx").onChange(async v => {
        hist.clientVersion = v.trim() || "2.20240726.00.00"; await this.onSettingsChange();
      }));

    // ── Display ────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Display" });

    new Setting(containerEl)
      .setName("Default sort order")
      .addDropdown(d => {
        d.addOption("frequency", "Frequency");
        d.addOption("headword", "Headword (あいうえお)");
        d.addOption("createdAt", "Date added");
        d.addOption("updatedAt", "Last updated");
        d.setValue(this.settings.defaultSortOrder).onChange(async v => {
          this.settings.defaultSortOrder = v as PluginSettings["defaultSortOrder"];
          await this.onSettingsChange();
        });
      });

    new Setting(containerEl)
      .setName("Entries per page")
      .addSlider(s => s.setLimits(10, 200, 10).setValue(this.settings.entriesPerPage)
        .setDynamicTooltip().onChange(async v => {
          this.settings.entriesPerPage = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Show readings")
      .addToggle(t => t.setValue(this.settings.showReadings).onChange(async v => {
        this.settings.showReadings = v;
        await this.onSettingsChange();
      }));

    // ── Search ─────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Search" });

    new Setting(containerEl)
      .setName("Max results")
      .addSlider(s => s.setLimits(10, 500, 10).setValue(this.settings.maxResults)
        .setDynamicTooltip().onChange(async v => {
          this.settings.maxResults = v;
          await this.onSettingsChange();
        }));

    // ── Data Management ────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Data Management" });

    new Setting(containerEl)
      .setName("Export data")
      .setDesc("Export all collocations as a JSON file")
      .addButton(b => b.setButtonText("Export JSON").onClick(() => {
        const data = JSON.stringify(this.store.exportAll(), null, 2);
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "jp-collocations-export.json";
        a.click();
        URL.revokeObjectURL(url);
        new Notice("Exported collocations.");
      }));

    new Setting(containerEl)
      .setName("Import data")
      .setDesc("Import collocations from a JSON file")
      .addButton(b => b.setButtonText("Import JSON").onClick(() => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          const text = await file.text();
          try {
            const parsed = JSON.parse(text);
            const count = this.store.bulkImport(parsed);
            new Notice(`Imported ${count} entries.`);
          } catch {
            new Notice("Failed to parse JSON file.");
          }
        };
        input.click();
      }));

    new Setting(containerEl)
      .setName("Reset to seed data")
      .setDesc("Clear all data and restore the built-in collocations")
      .addButton(b => b.setButtonText("Reset").setWarning().onClick(async () => {
        await this.store.resetToSeed();
        new Notice("Reset to seed data.");
      }));

    new Setting(containerEl)
      .setName("Clear all data")
      .setDesc("Delete all collocation entries permanently")
      .addButton(b => b.setButtonText("Clear All").setWarning().onClick(async () => {
        await this.store.clearAll();
        new Notice("All data cleared.");
      }));

    // ── 発話セッション (§25.5) — the rubric is DATA, never entrenched ────
    containerEl.createEl("h3", { text: "発話セッション（なりきりスピーキング）" });

    new Setting(containerEl)
      .setName("自己評価の観点")
      .setDesc("🎤の後に0–4で評価する観点（読点・カンマ区切り）。練習の進化に合わせて自由に変更を。")
      .addTextArea(t => t
        .setValue(this.settings.speak.aspects.join("、"))
        .onChange(async v => {
          const aspects = v.split(/[、,]/).map(s => s.trim()).filter(Boolean);
          if (aspects.length) this.settings.speak.aspects = aspects;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("目標ポイント")
      .setDesc("🔢カウンター制のセッション目標（評価点の合計がここへ向かう）")
      .addText(t => t
        .setValue(String(this.settings.speak.goalPoints))
        .onChange(async v => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n > 0) this.settings.speak.goalPoints = n;
          await this.onSettingsChange();
        }));

    // ── SRS Card Generation ──────────────────────────────────────
    containerEl.createEl("h3", { text: "SRS Card Generation" });

    new Setting(containerEl)
      .setName("Tag prefix")
      .setDesc("Base tag for Spaced Repetition cards (e.g. flashcards/jp)")
      .addText(t => t.setValue(this.settings.srs.tagPrefix).onChange(async v => {
        this.settings.srs.tagPrefix = v.trim() || 'flashcards/jp';
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("Speaker format")
      .setDesc("How to display speakers in discourse chunk cards")
      .addDropdown(d => {
        d.addOption("icon", "Icon (🔵🟠🟢🟣)");
        d.addOption("letter", "Letter (A/B/C/D)");
        d.addOption("number", "Number (1/2/3/4)");
        d.setValue(this.settings.srs.speakerFormat).onChange(async v => {
          this.settings.srs.speakerFormat = v as SpeakerFormat;
          await this.onSettingsChange();
        });
      });

    new Setting(containerEl)
      .setName("Include register labels")
      .addToggle(t => t.setValue(this.settings.srs.includeRegister).onChange(async v => {
        this.settings.srs.includeRegister = v;
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("Include relation arrows")
      .addToggle(t => t.setValue(this.settings.srs.includeRelations).onChange(async v => {
        this.settings.srs.includeRelations = v;
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("Include English glosses")
      .addToggle(t => t.setValue(this.settings.srs.includeEnglish).onChange(async v => {
        this.settings.srs.includeEnglish = v;
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("Include timestamps")
      .addToggle(t => t.setValue(this.settings.srs.includeTimestamps).onChange(async v => {
        this.settings.srs.includeTimestamps = v;
        await this.onSettingsChange();
      }));

    new Setting(containerEl)
      .setName("Max bits per card")
      .setDesc("Maximum discourse chunks (spoiler blocks) per card")
      .addSlider(s => s.setLimits(2, 12, 1).setValue(this.settings.srs.maxBitsPerCard)
        .setDynamicTooltip().onChange(async v => {
          this.settings.srs.maxBitsPerCard = v;
          await this.onSettingsChange();
        }));

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc("Folder for generated SRS card files")
      .addText(t => t.setValue(this.settings.srs.outputFolder).onChange(async v => {
        this.settings.srs.outputFolder = v.trim() || 'JP SRS Cards';
        await this.onSettingsChange();
      }));

    // ── Stats ──────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Statistics" });
    const stats = this.store.getStats();
    containerEl.createEl("p", { text: `Total entries: ${stats.total}` });

    const posList = containerEl.createEl("ul");
    for (const [pos, count] of Object.entries(stats.byPOS)) {
      posList.createEl("li", { text: `${pos}: ${count}` });
    }

    const srcList = containerEl.createEl("ul");
    for (const [src, count] of Object.entries(stats.bySource)) {
      srcList.createEl("li", { text: `${src}: ${count}` });
    }
  }
}
