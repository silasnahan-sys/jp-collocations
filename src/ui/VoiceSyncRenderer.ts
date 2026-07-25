/**
 * VoiceSyncRenderer.ts — the `jp-voicesync` code block: whispersync-style
 * karaoke playback with speaker identification.
 *
 *   ```jp-voicesync
 *   {"clip":"clip_<id>_<sec>.mp3"}
 *   ```
 *
 * v2: speakers are NAMEABLE (🏷 header button → play each voice, type the
 * name; a reference wav is enrolled so every future clip auto-identifies that
 * person), and any segment can be CORRECTED via its ✎ menu (rename the whole
 * speaker / reassign just this stretch). All edits persist to the sidecar and
 * re-render in place.
 */

import { Plugin, TFile, Notice, Modal, Menu, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import { voiceSyncSidecarName, rebuildSegments, type VoiceSyncData, type VsTurn } from '../notes/voice-lab.ts';

/**
 * Speaker channel colors — the RESERVED speaker band (styles.css --jp-spk-*).
 * These were the six taxonomy hexes, which made a 連語-blue rail and a
 * "speaker A" rail the same color on two surfaces (DESIGN §26.0 rule 4).
 * Identity colors belong to the class taxonomy alone; speakers get their own.
 */
const PALETTE = ['#7b5cd6', '#17a2a2', '#c2698b', '#8a94a6', '#9b59b6', '#16a085'];

/** Host callbacks (implemented in main.ts — settings + fs live there). */
export interface VoiceSyncHost {
  saveSidecar(sidecarFile: TFile, data: VoiceSyncData): Promise<void>;
  /** Name a speaker id + enroll its voice (reference wav → profile). */
  enrollSpeaker(clipFile: TFile, data: VoiceSyncData, spk: string, name: string): Promise<void>;
  knownNames(): string[];
}

/** stop-others registry: only one voicesync block plays at a time */
let current: { stop: () => void } | null = null;
const stopCurrent = () => { if (current) { current.stop(); current = null; } };

export function registerVoiceSync(plugin: Plugin, host: VoiceSyncHost): void {
  plugin.registerMarkdownCodeBlockProcessor('jp-voicesync', async (source, el, ctx) => {
    let clipName = '';
    try { clipName = (JSON.parse(source) as { clip?: string }).clip ?? ''; } catch { /* */ }
    if (!clipName) { el.createEl('div', { text: 'jp-voicesync: {"clip":"…mp3"} が必要です' }); return; }

    const clipFile = plugin.app.metadataCache.getFirstLinkpathDest(clipName, ctx.sourcePath);
    if (!clipFile) { renderMissing(el, `クリップが見つかりません: ${clipName}`); return; }
    const sidecarPath = clipFile.parent
      ? `${clipFile.parent.path}/${voiceSyncSidecarName(clipName)}`
      : voiceSyncSidecarName(clipName);
    const sidecar = plugin.app.vault.getAbstractFileByPath(sidecarPath);
    if (!(sidecar instanceof TFile)) {
      renderMissing(el, '音声解析データ未生成 — 「Enrich Clips with VoiceSync」を実行');
      return;
    }
    let data: VoiceSyncData;
    try { data = JSON.parse(await plugin.app.vault.cachedRead(sidecar)) as VoiceSyncData; }
    catch { renderMissing(el, 'voicesync データを解析できません'); return; }

    const container = el.createDiv();
    const draw = () => {
      container.empty();
      renderBlock({
        app: plugin.app, container, data,
        srcUrl: plugin.app.vault.getResourcePath(clipFile),
        host, clipFile, sidecarFile: sidecar,
        redraw: draw,
      });
    };
    draw();
  });
}

function renderMissing(el: HTMLElement, msg: string): void {
  el.createDiv({ cls: 'jp-vs jp-vs-missing' }).setText(`🗣 ${msg}`);
}

interface Ctx {
  app: App;
  container: HTMLElement;
  data: VoiceSyncData;
  srcUrl: string;
  host: VoiceSyncHost;
  clipFile: TFile;
  sidecarFile: TFile;
  redraw: () => void;
}

const spkLabel = (data: VoiceSyncData, spk: string, order: string[]): string =>
  data.speakers[spk] ?? `話者${String.fromCharCode(65 + Math.max(0, order.indexOf(spk)))}`;

function renderBlock(cx: Ctx): void {
  const { data, container } = cx;
  const root = container.createDiv({ cls: 'jp-vs' });
  const spkOrder = [...new Set([...data.segments.map((s) => s.spk), ...data.turns.map((t) => t.spk)])];
  const colorOf = (spk: string) => PALETTE[Math.max(0, spkOrder.indexOf(spk)) % PALETTE.length];

  // ── audio (lazy) + seek ──
  let audio: HTMLAudioElement | null = null;
  let raf = 0;
  const tokenEls: { t0: number; t1: number; el: HTMLElement }[] = [];
  const btn = { el: null as HTMLButtonElement | null };
  const stop = () => {
    cancelAnimationFrame(raf);
    if (audio) audio.pause();
    btn.el?.setText('▶');
    for (const tk of tokenEls) tk.el.removeClass('jp-vs-cur');
  };
  const tick = () => {
    if (!audio) return;
    const t = audio.currentTime;
    let cur: HTMLElement | null = null;
    for (const tk of tokenEls) {
      const on = t >= tk.t0 && t < tk.t1 + 0.05;
      tk.el.toggleClass('jp-vs-cur', on);
      if (on) cur = tk.el;
    }
    if (cur) cur.scrollIntoView({ block: 'nearest' });
    raf = requestAnimationFrame(tick);
  };
  const ensureAudio = () => {
    if (audio) return;
    stopCurrent();
    audio = new Audio(cx.srcUrl);
    current = { stop: () => { stop(); audio = null; } };
    audio.onended = () => stop();
    audio.onplay = () => { raf = requestAnimationFrame(tick); };
    audio.onpause = () => cancelAnimationFrame(raf);
  };
  const seek = (t: number) => { ensureAudio(); if (audio) { audio.currentTime = t; void audio.play(); btn.el?.setText('⏸'); } };
  const playRange = (t0: number, t1: number) => {
    seek(t0);
    const guard = () => {
      if (audio && audio.currentTime >= t1) { audio.pause(); btn.el?.setText('▶'); }
      else if (audio && !audio.paused) requestAnimationFrame(guard);
    };
    requestAnimationFrame(guard);
  };

  // ── header: play + name-button + legend ──
  const head = root.createDiv({ cls: 'jp-vs-head' });
  btn.el = head.createEl('button', { text: '▶', cls: 'jp-vs-play' });
  btn.el.onclick = () => {
    ensureAudio();
    if (!audio) return;
    if (audio.paused) { void audio.play().catch((e) => new Notice(`再生失敗: ${e}`)); btn.el?.setText('⏸'); }
    else { audio.pause(); btn.el?.setText('▶'); }
  };
  const tag = head.createEl('button', { cls: 'jp-vs-tag' });
  setIcon(tag, 'tag');
  tag.title = '話者に名前を付ける（声を登録すると以後のクリップで自動識別）';
  tag.onclick = () => new NameSpeakersModal(cx, spkOrder, colorOf, playRange).open();
  head.createSpan({ text: data.clip, cls: 'jp-vs-name' });
  const legend = head.createDiv({ cls: 'jp-vs-legend' });
  for (const spk of spkOrder) {
    const chip = legend.createSpan({ cls: 'jp-vs-chip' });
    chip.createSpan({ cls: 'jp-vs-dot' }).style.background = colorOf(spk);
    chip.createSpan({ text: spkLabel(data, spk, spkOrder) });
  }

  // ── body: segments + backchannel pills interleaved by time ──
  const body = root.createDiv({ cls: 'jp-vs-body' });
  const tokened = (turn: VsTurn) =>
    data.tokens.some((tk) => tk.spk === turn.spk && (tk.t0 + tk.t1) / 2 >= turn.t0 && (tk.t0 + tk.t1) / 2 <= turn.t1);
  type Item = { t0: number; segIdx?: number; pill?: VsTurn };
  const items: Item[] = [
    ...data.segments.map((seg, i) => ({ t0: seg.t0, segIdx: i })),
    ...data.turns.filter((t) => !tokened(t)).map((pill) => ({ t0: pill.t0, pill })),
  ].sort((a, b) => a.t0 - b.t0);

  for (const it of items) {
    if (it.segIdx != null) {
      const seg = data.segments[it.segIdx];
      const line = body.createDiv({ cls: 'jp-vs-seg' + (seg.overlap ? ' jp-vs-overlap' : '') });
      line.style.borderLeftColor = colorOf(seg.spk);
      const who = line.createSpan({ cls: 'jp-vs-who' });
      who.setText(spkLabel(data, seg.spk, spkOrder));
      who.style.color = colorOf(seg.spk);
      const fix = line.createSpan({ cls: 'jp-vs-fix' });
      setIcon(fix, 'pencil');
      fix.onclick = (ev) => segmentMenu(cx, it.segIdx as number, spkOrder, ev);
      const text = line.createSpan({ cls: 'jp-vs-text' });
      for (let i = seg.tokenIdx[0]; i <= seg.tokenIdx[1]; i++) {
        const tk = data.tokens[i];
        if (!tk) continue;
        const s = text.createSpan({ text: tk.text, cls: 'jp-vs-tok' });
        s.onclick = () => seek(tk.t0);
        s.oncontextmenu = (ev) => { ev.preventDefault(); tokenSplitMenu(cx, it.segIdx as number, i, spkOrder, ev); };
        tokenEls.push({ t0: tk.t0, t1: tk.t1, el: s });
      }
    } else if (it.pill) {
      const pill = body.createSpan({ cls: 'jp-vs-pill' });
      pill.style.borderColor = colorOf(it.pill.spk);
      pill.setText(`🗨 ${spkLabel(data, it.pill.spk, spkOrder)} ${it.pill.t0.toFixed(1)}s`);
      pill.onclick = () => seek(Math.max(0, it.pill!.t0 - 0.3));
    }
  }
}

// ── right-click a word: split the segment HERE and reassign the tail ──────────
// The manual fix for seamless handovers between near-identical voices, which
// no local diarization can hear (verified) — 2 clicks: right-click the first
// word of the new speaker, pick who.

function tokenSplitMenu(cx: Ctx, segIdx: number, tokenIdx: number, spkOrder: string[], ev: MouseEvent): void {
  const { data } = cx;
  const seg = data.segments[segIdx];
  const apply = async (spk: string) => {
    for (let k = tokenIdx; k <= seg.tokenIdx[1]; k++) if (data.tokens[k]) data.tokens[k].spk = spk;
    if (data.tokens[tokenIdx]) data.tokens[tokenIdx].segStart = true;   // permanent cut point
    data.segments = rebuildSegments(data.tokens);
    await cx.host.saveSidecar(cx.sidecarFile, data);
    cx.redraw();
  };
  const menu = new Menu();
  menu.addItem((i) => i.setTitle('ここから話者を変更').setIsLabel(true));
  for (const spk of spkOrder) {
    if (spk === seg.spk) continue;
    menu.addItem((i) => i.setTitle(`　→ ${spkLabel(data, spk, spkOrder)}`).onClick(() => void apply(spk)));
  }
  menu.addItem((i) => i.setTitle('　→ 🆕 新しい話者').onClick(() => {
    void apply('speaker_' + String(
      Math.max(-1, ...spkOrder.map((s) => parseInt(s.replace(/\D+/g, ''), 10) || 0)) + 1
    ).padStart(2, '0'));
  }));
  menu.showAtMouseEvent(ev);
}

// ── ✎ segment menu: rename speaker / reassign this stretch ─────────────────────

function segmentMenu(cx: Ctx, segIdx: number, spkOrder: string[], ev: MouseEvent): void {
  const { data } = cx;
  const seg = data.segments[segIdx];
  const menu = new Menu();
  const names = [...new Set([...cx.host.knownNames(), ...Object.values(data.speakers)])];

  menu.addItem((i) => i.setTitle(`「${spkLabel(data, seg.spk, spkOrder)}」に名前を付ける`).setIsLabel(true));
  for (const n of names) {
    menu.addItem((i) => i.setTitle(`　${n}`).onClick(async () => {
      data.speakers[seg.spk] = n;
      await cx.host.saveSidecar(cx.sidecarFile, data);
      cx.redraw();
    }));
  }
  menu.addItem((i) => i.setTitle('　新しい名前…（声も登録）').onClick(() => {
    new AskNameModal(cx.app, async (name) => {
      if (!name) return;
      await cx.host.enrollSpeaker(cx.clipFile, data, seg.spk, name);
      await cx.host.saveSidecar(cx.sidecarFile, data);
      cx.redraw();
    }).open();
  }));

  menu.addSeparator();
  menu.addItem((i) => i.setTitle('この区間の話者を変更').setIsLabel(true));
  for (const spk of spkOrder) {
    if (spk === seg.spk) continue;
    menu.addItem((i) => i.setTitle(`　→ ${spkLabel(data, spk, spkOrder)}`).onClick(async () => {
      for (let k = seg.tokenIdx[0]; k <= seg.tokenIdx[1]; k++) if (data.tokens[k]) data.tokens[k].spk = spk;
      data.segments = rebuildSegments(data.tokens);
      await cx.host.saveSidecar(cx.sidecarFile, data);
      cx.redraw();
    }));
  }
  // diarizer merged a third voice into this cluster → carve this stretch out
  menu.addItem((i) => i.setTitle('　→ 🆕 新しい話者として分離').onClick(async () => {
    const next = 'speaker_' + String(
      Math.max(-1, ...spkOrder.map((s) => parseInt(s.replace(/\D+/g, ''), 10) || 0)) + 1
    ).padStart(2, '0');
    for (let k = seg.tokenIdx[0]; k <= seg.tokenIdx[1]; k++) if (data.tokens[k]) data.tokens[k].spk = next;
    data.segments = rebuildSegments(data.tokens);
    await cx.host.saveSidecar(cx.sidecarFile, data);
    cx.redraw();
  }));
  menu.showAtMouseEvent(ev);
}

// ── 🏷 naming modal ─────────────────────────────────────────────────────────────

class NameSpeakersModal extends Modal {
  constructor(
    private cx: Ctx,
    private spkOrder: string[],
    private colorOf: (spk: string) => string,
    private playRange: (t0: number, t1: number) => void,
  ) { super(cx.app); }

  onOpen(): void {
    const { data } = this.cx;
    this.titleEl.setText('話者に名前を付ける');
    this.contentEl.createEl('p', {
      text: '▶ で声を確認して名前を入力。保存すると声が登録され、以後のクリップでこの人は自動識別されます。',
      cls: 'setting-item-description',
    });
    const inputs = new Map<string, HTMLInputElement>();
    for (const spk of this.spkOrder) {
      // longest segment of this speaker = the cleanest voice sample
      const segs = data.segments.filter((s) => s.spk === spk);
      const longest = segs.sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0))[0];
      const row = this.contentEl.createDiv({ cls: 'jp-vs-namerow' });
      row.createSpan({ cls: 'jp-vs-dot' }).style.background = this.colorOf(spk);
      const play = row.createEl('button', { text: '▶' });
      play.onclick = () => { if (longest) this.playRange(longest.t0, Math.min(longest.t1, longest.t0 + 6)); };
      row.createSpan({ text: `${spkLabel(data, spk, this.spkOrder)}（${segs.length}区間）` });
      const input = row.createEl('input', { type: 'text' });
      input.placeholder = '名前（空 = 変更なし）';
      input.value = data.speakers[spk] ?? '';
      inputs.set(spk, input);
    }
    const saveBtn = this.contentEl.createEl('button', { text: '💾 保存して声を登録', cls: 'mod-cta' });
    saveBtn.onclick = async () => {
      const busy = new Notice('声を登録中…', 0);
      try {
        for (const [spk, input] of inputs) {
          const name = input.value.trim();
          if (!name || data.speakers[spk] === name) continue;
          await this.cx.host.enrollSpeaker(this.cx.clipFile, data, spk, name);
        }
        await this.cx.host.saveSidecar(this.cx.sidecarFile, data);
      } finally { busy.hide(); }
      this.close();
      this.cx.redraw();
      new Notice('保存しました。「Re-identify Speakers in All Clips」で全クリップに適用できます。', 8000);
    };
  }
}

class AskNameModal extends Modal {
  constructor(app: App, private onDone: (name: string) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText('新しい話者名');
    const input = this.contentEl.createEl('input', { type: 'text' });
    input.style.width = '100%';
    const ok = this.contentEl.createEl('button', { text: 'OK', cls: 'mod-cta' });
    const done = () => { this.close(); this.onDone(input.value.trim()); };
    ok.onclick = done;
    input.onkeydown = (e) => { if (e.key === 'Enter') done(); };
    input.focus();
  }
}
