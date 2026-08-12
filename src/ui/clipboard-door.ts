/**
 * clipboard-door.ts — the way in for everything that happens in another app.
 *
 * ## Why this exists
 *
 * MEASURED 2026-08-08, from two camera recordings of the iPad. The plugin is
 * not the app; it is one station in a pipeline whose other stations are
 * Manatan (the manga reader), Apple Notes, a reference-doc viewer and Safari.
 * And every one of those ends the same way:
 *
 *   - Manatan OCRs a panel and says 「Sentence copied to clipboard.」 (v1≈332s)
 *   - a selection in the reference doc offers exactly one verb: Copy (v2≈320s)
 *   - Apple Notes' callout offers Cut / Copy / Paste
 *
 * The system clipboard is the ONLY channel those apps share with this one. The
 * drag road (`drop-router.ts`) is better when it works, but it needs both apps
 * on screen at once, and half of what he does is full-screen in Manatan.
 *
 * Before this file, arriving with something copied meant: switch to Obsidian →
 * find the 収集トレイ tab → scroll to the drop zone → tap 📋クリップボードから.
 * Four moves, three of them navigation, for a thing already in your hand. So it
 * did not happen, and the reading stayed in the other app.
 *
 * ## What it does
 *
 * One button, on every surface that has a bar, that takes what you copied and
 * sends it down **the same road a drop takes** — `dropIntents` decides what
 * arrived and the same executor runs it (§28 S5: one road in). Being on the
 * 辞書 when you tap it means a copied word becomes a lookup; being on the tray
 * means it becomes a card. The door does not need its own verbs because the
 * classifier already has all of them.
 *
 * ## The platform constraint, stated once
 *
 * Since iOS 16, a programmatic `navigator.clipboard.readText()` raises a system
 * "Paste" confirmation unless it happens inside a user gesture. So this CANNOT
 * be a focus-time watcher that silently notices what you copied and offers it —
 * on the device this is for, that design would fire a permission prompt at every
 * app switch, which is worse than the problem it solves.
 *
 * The read therefore happens inside the tap, where iOS is happy to allow it and
 * where the user has already said what they want. One tap from anywhere is the
 * whole promise, and it is a promise the platform will actually keep.
 *
 * ## What the door could not see
 *
 * It read `navigator.clipboard.readText()` and built its sample by hand as
 * `{text, kinds: ['text/plain'], files: []}`. Two things were invisible through
 * that window, and both of them are the thing you would most want to send:
 *
 *   - **A picture.** `readText()` returns `''` for an image on the clipboard,
 *     so the door reported 「クリップボードが空です」 — a false statement about
 *     a full clipboard — on the ONE channel Manatan and Apple Notes share with
 *     this plugin. `read()` sees both halves and costs the same single gesture.
 *   - **A picture the vault already holds.** Copy an embed out of a note and
 *     the clipboard holds `![[パネル.png]]`; copy an image address and it holds
 *     `app://…` / `capacitor://…` / on Android `http://localhost/…`. Neither
 *     could reach the vault-image branch of the classifier, because that branch
 *     reads `uriList` and `inVault` and this door supplied neither.
 *
 * The sample is therefore built from what is ACTUALLY on the clipboard rather
 * than from an assumption about it, and the verbs follow for free — the door
 * still has none of its own (§28 S5).
 */

import { Notice } from 'obsidian';
import { dropIntents, type DropIntent, type DropSample, type DropSurface } from '../notes/drop-intent.ts';
import { isDeviceUrl, isRemoteUrl, type InVault } from '../notes/resource-url.ts';

export interface ClipboardDoorDeps {
  /** Re-read per tap: the 語彙 list becomes an entry when one is open. */
  surface: () => DropSurface;
  /** Capabilities, re-read per tap — settings change without a reload. */
  can: () => { ocr?: boolean; x?: boolean };
  /** §28 S5 — the one road in. Same executor the drop road hands to. */
  run: (intent: DropIntent, files: File[]) => void | Promise<void>;
  /** The headword of the entry open right now, when there is one. */
  entryKey?: () => string | undefined;
  /** Ask the vault whether a path is real — what lets a copied embed or image
   *  address be recognised as the picture the vault is already holding, rather
   *  than as a link, or as a wish. See `notes/resource-url.ts`. */
  inVault?: InVault;
}

/** What a clipboard read came back with. Either half may be empty. */
export interface ClipboardTake {
  text: string;
  /** Pictures, in the order `run` will receive them — `fileIdx` indexes this. */
  files: File[];
}

/**
 * The clipboard, described the way a drop describes itself.
 *
 * Exported and pure because this is the whole of what was wrong: a hand-built
 * `kinds: ['text/plain']` claimed the clipboard held plain text and nothing
 * else, and the classifier believed it. A URL is put on `text/uri-list` as well
 * as `text/plain` — which is what a real clipboard write of a URL does, and
 * what unlocks the vault-image branch — and pictures are declared as files.
 *
 * `text/uri-list` is added ONLY when there really is a URL: an empty one in
 * `kinds` is worse than none, because its presence alone makes the classifier
 * offer link verbs for a carry that has no link.
 */
export function clipboardSample(take: { text?: string; files?: ReadonlyArray<{ name?: string; type?: string }> }): DropSample {
  const t = (take.text ?? '').trim();
  const files = take.files ?? [];
  const asUri = t && !/\s/.test(t) && (isDeviceUrl(t) || isRemoteUrl(t)) ? t : null;
  return {
    ...(t ? { text: t } : {}),
    ...(asUri ? { uriList: asUri } : {}),
    kinds: [
      ...(t ? ['text/plain'] : []),
      ...(asUri ? ['text/uri-list'] : []),
      ...(files.length ? ['Files'] : []),
    ],
    files,
  };
}

/**
 * What the clipboard would become if you let it in, or null when it is not
 * something this plugin has a verb for.
 *
 * Pure, and the only part worth testing: the leading intent wins, which is the
 * same rule the drop road uses when an aim turns out unsupportable
 * ("specificity decides the default, never the surface").
 */
export function clipboardIntent(
  text: string,
  ctx: {
    surface: DropSurface;
    can?: { ocr?: boolean; x?: boolean };
    entryKey?: string;
    inVault?: InVault;
    /** Pictures on the clipboard, described as the drop road describes files. */
    files?: ReadonlyArray<{ name?: string; type?: string }>;
  },
): DropIntent | null {
  const sample = clipboardSample({ text, files: ctx.files });
  if (!sample.text && !(sample.files ?? []).length) return null;
  return dropIntents(sample, ctx)[0] ?? null;
}

/** `image/png` → `png`, for a name the vault can file by extension. */
function extOf(mime: string): string {
  const sub = mime.split('/')[1]?.split('+')[0]?.toLowerCase() ?? 'png';
  return sub === 'jpeg' ? 'jpg' : sub.replace(/[^a-z0-9]/g, '') || 'png';
}

/**
 * Take everything the clipboard holds, in ONE read.
 *
 * One read, not two, and that is load-bearing rather than tidy: every read
 * costs a system Paste prompt on iOS, and a door that asks twice for one tap is
 * a door nobody taps again. So text and pictures come out of the same
 * `read()` — which also means an Apple Notes handwriting selection, copied as
 * strokes PLUS its recognised text, arrives as the pair it is.
 *
 * `readText()` is the fallback, and the two ways of reaching it are not equal.
 * A platform with no `read()` at all is detected synchronously, before anything
 * is awaited, so the gesture is still alive when the fallback runs — the old
 * behaviour exactly. A `read()` that REJECTS puts the retry past an await,
 * where iOS may refuse it in turn; that is a clipboard which was not going to
 * be read either way, and the caller says so rather than failing quietly.
 */
export async function readClipboard(): Promise<ClipboardTake> {
  const cb = navigator.clipboard;
  if (typeof cb?.read === 'function') {
    try {
      const items = await cb.read();
      const files: File[] = [];
      let text = '';
      for (const item of items) {
        const img = item.types.find((t) => t.startsWith('image/'));
        if (img) {
          const blob = await item.getType(img);
          files.push(new File([blob], `clipboard-${Date.now()}-${files.length}.${extOf(img)}`, { type: img }));
        }
        // Not `else`: one item can carry both, and that pair is the whole
        // reason a Manatan panel or a Notes lasso is worth receiving at all.
        if (!text && item.types.includes('text/plain')) {
          text = await (await item.getType('text/plain')).text();
        }
      }
      return { text, files };
    } catch { /* no permission, or a shape this platform will not describe */ }
  }
  return { text: (await cb.readText()) ?? '', files: [] };
}

/**
 * The last thing this door took in. A second tap on an unchanged clipboard is
 * almost always a mis-tap or an impatient one, and silently making a duplicate
 * card is how a tray fills with noise — so say it instead of doing it.
 */
let lastTaken = '';

/** Forget what was taken — for tests, and for a vault switch. */
export function resetClipboardDoor(): void { lastTaken = ''; }

/** True when this is worth offering: non-empty and not the last thing taken. */
export function isFreshClipboard(key: string): boolean {
  const t = (key ?? '').trim();
  return !!t && t !== lastTaken;
}

/**
 * What "the same clipboard" means once it is not only text.
 *
 * Pictures cannot be compared without reading them, so identity is the text
 * plus each picture's type and size. Two different screenshots can collide in
 * principle; a screenshot and the same screenshot with a sentence beside it
 * cannot, and that is the pair the freshness guard used to swallow — the words
 * were identical, so the second tap looked like a mis-tap.
 *
 * The separator is `\u0000` and it has to be something `trim()` will not touch:
 * `isFreshClipboard` trims what it is handed, so a key joined with a SPACE and
 * stored for a picture that came with no words would come back trimmed and
 * never compare equal to itself — waving through every repeat of the one case
 * this was extended to cover.
 */
export function freshnessKey(take: { text?: string; files?: ReadonlyArray<{ type?: string; size?: number }> }): string {
  const t = (take.text ?? '').trim();
  const shape = (take.files ?? []).map((f) => `${f.type ?? '?'}:${f.size ?? 0}`).join('|');
  return shape ? `${t}\u0000${shape}` : t;
}

/**
 * Read the clipboard and route it. MUST be called from inside a user gesture —
 * see the platform note at the top of this file.
 */
export async function receiveClipboard(deps: ClipboardDoorDeps): Promise<void> {
  let take: ClipboardTake;
  try {
    take = await readClipboard();
  } catch {
    new Notice(
      '📋 クリップボードを読めませんでした。\niPad では一度だけ出る「ペースト」を許可してください。',
      9000,
    );
    return;
  }
  const text = take.text.trim();
  // Only now is it honest to say this: `readText()` alone reported an empty
  // clipboard for a clipboard holding a picture.
  if (!text && !take.files.length) { new Notice('📋 クリップボードが空です', 4000); return; }

  const key = freshnessKey(take);
  if (!isFreshClipboard(key)) { new Notice('📋 さっき受け取ったものと同じです', 4000); return; }

  const intent = clipboardIntent(text, {
    surface: deps.surface(),
    can: deps.can(),
    entryKey: deps.entryKey?.(),
    files: take.files.map((f) => ({ name: f.name, type: f.type })),
    ...(deps.inVault ? { inVault: deps.inVault } : {}),
  });
  // The classifier has a verb for essentially any text, so this is rare — but a
  // door that silently does nothing is the thing this file exists to delete.
  if (!intent) { new Notice('📋 受け取れる形ではありませんでした', 5000); return; }

  lastTaken = key;
  await deps.run(intent, take.files);
}

/**
 * Put the door in `host` and return it.
 *
 * Deliberately NOT a new floating thing. The rail holds tools that act on what
 * is in front of you, and receiving what you just copied is exactly that — so
 * it goes in the tools dock beside ⚡, where the writing hand already is, and
 * adds one button rather than a sixth bar.
 */
export function mountClipboardDoor(host: HTMLElement, deps: ClipboardDoorDeps): HTMLElement {
  const btn = host.createEl('button', {
    cls: 'jp-surfbar-btn jp-cbdoor',
    attr: { 'aria-label': '受け取る', title: 'コピーしたものを受け取る' },
  });
  btn.createSpan({ cls: 'jp-surfbar-glyph', text: '📋' });
  btn.onclick = () => { void receiveClipboard(deps); };
  return btn;
}
