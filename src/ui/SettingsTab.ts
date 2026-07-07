import { PluginSettingTab, Setting, Notice, Platform } from "obsidian";
import type { App } from "obsidian";
import { detectTools } from "../notes/audio-extractor.ts";
import { USERSCRIPT_SOURCE } from "../x/mobile-capture.ts";
import type { Plugin } from "obsidian";
import type { PluginSettings, SpeakerFormat } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import type { HyogenScraper } from "../scraper/HyogenScraper.ts";

export class SettingsTab extends PluginSettingTab {
  private settings: PluginSettings;
  private store: CollocationStore;
  private getScraper: () => HyogenScraper | null;
  private onSettingsChange: () => Promise<void>;

  constructor(
    app: App,
    plugin: Plugin,
    settings: PluginSettings,
    store: CollocationStore,
    getScraper: () => HyogenScraper | null,
    onSettingsChange: () => Promise<void>
  ) {
    super(app, plugin);
    this.settings = settings;
    this.store = store;
    this.getScraper = getScraper;
    this.onSettingsChange = onSettingsChange;
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

    // ── Live watch history (cookie auth) ──────────────────────────
    containerEl.createEl("h3", { text: "視聴履歴（Cookie）— 期間指定で取得" });
    const hist = this.settings.ytHistory;
    const histDesc = containerEl.createEl("p", { cls: "setting-item-description" });
    histDesc.innerHTML =
      "youtube.com のログイン Cookie を<b>一度だけ</b>貼り付けると、「視聴日の範囲」を指定してサーバー側の視聴履歴（全デバイス）を取得できます。X 機能と同じ方式。<br>" +
      "<b>取得方法:</b> ブラウザで youtube.com にログイン → DevTools(F12) → Network → 任意の <code>youtubei</code> リクエスト → Request Headers の <code>cookie:</code> の値を丸ごとコピー。<br>" +
      "貼り付け後、コマンド「Reconciliation Health Check」で接続を確認できます（失効時は再貼り付け）。";

    new Setting(containerEl)
      .setName("YouTube Cookie")
      .setDesc("youtube.com の cookie ヘッダ全体（SAPISID を含む必要あり）。秘密情報として保存されます。")
      .addTextArea(t => {
        t.setValue(hist.cookie).setPlaceholder("SID=...; SAPISID=...; __Secure-3PAPISID=...; ...").onChange(async v => {
          hist.cookie = v.trim(); await this.onSettingsChange();
        });
        t.inputEl.rows = 3;
        t.inputEl.style.width = "100%";
      });

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
