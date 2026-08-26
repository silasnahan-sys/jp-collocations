/**
 * golden/drop-intent.mjs — the drag-and-drop router's brain.
 *
 * One gesture now stands in for eight commands (文字起こし取得 / X 投稿追加 /
 * 字幕取り込み / 視聴履歴 / 画像OCR / 分類キャプチャ / 辞書 / トレイ), so the
 * classifier has to be right about real payloads, not tidy ones. Every URL,
 * subtitle body and phrase below is the shape that actually arrives when you
 * drag out of Safari, Apple Notes, Files or jimaku on an iPad.
 *
 * The rule under test throughout: **specificity decides the default, never the
 * surface.** A YouTube link dropped on the dictionary is still a YouTube link.
 *
 * Run:  node golden/drop-intent.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const D = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'drop-intent.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

/** The actions offered, in order — the only thing the UI actually consumes. */
const acts = (sample, ctx = { surface: 'lexicon' }) => D.dropIntents(sample, ctx).map((i) => i.action);
const first = (sample, ctx = { surface: 'lexicon' }) => D.dropIntents(sample, ctx)[0];

console.log('\n══ YouTube: a link is a video, wherever you drop it ══');
{
  const url = 'https://www.youtube.com/watch?v=0z91Gp-V8fE';
  check('a watch URL leads with 文字起こし', first({ text: url }).action === 'yt-transcript');
  check('youtu.be short form too', first({ text: 'https://youtu.be/0z91Gp-V8fE' }).action === 'yt-transcript');
  check('/shorts/ too', first({ text: 'https://www.youtube.com/shorts/0z91Gp-V8fE' }).action === 'yt-transcript');
  check('dropped on the DICTIONARY it is still a video, not a lookup',
    first({ text: url }, { surface: 'dict' }).action === 'yt-transcript');
  check('dropped on an OPEN ENTRY it is still a video, not a 用例',
    first({ text: url }, { surface: 'entry', entryKey: 'ですね' }).action === 'yt-transcript');
  check('the detail names the concrete video', first({ text: url }).detail === 'youtu.be/0z91Gp-V8fE');
  check('the payload carries the id', first({ text: url }).payload.videoId === '0z91Gp-V8fE');
  // A link with a time in it is a link to a MOMENT — the mark verb outranks
  // the whole-video verb, because that is the thing you were pointing at.
  const at = 'https://youtu.be/0z91Gp-V8fE?t=65';
  check('?t= leads with 📍 マーク, not 文字起こし', first({ text: at }).action === 'yt-mark');
  check('…and still offers the transcript underneath', acts({ text: at }).includes('yt-transcript'));
  check('the second is parsed', first({ text: at }).payload.tSec === 65);
  check('1h2m3s form parses', D.parseTimeParam('https://youtu.be/x?t=1h2m3s') === 3723);
  check('&start= (embed form) parses', D.parseTimeParam('https://youtube.com/embed/x?start=90') === 90);
  check('no time param → null', D.parseTimeParam('https://youtu.be/0z91Gp-V8fE') === null);
  check('the mark detail prints a human clock', first({ text: at }).detail.startsWith('1:05'), first({ text: at }).detail);
  // 11 base64url chars appear inside plenty of URLs; the HOST has to agree.
  check('an 11-char run in a foreign URL is NOT a video',
    !acts({ text: 'https://example.com/a/0z91Gp-V8fE' }).includes('yt-transcript'));
}

console.log('\n══ X: a status link is a post, a bare profile is just a link ══');
{
  const t = 'https://x.com/hoge_jp/status/1798512345678901234';
  check('x.com status → 投稿を取り込む', first({ text: t }).action === 'x-post');
  check('twitter.com still works (old links never die)',
    first({ text: 'https://twitter.com/hoge_jp/status/1798512345678901234' }).action === 'x-post');
  check('the tweet id is extracted', first({ text: t }).payload.tweetId === '1798512345678901234');
  check('the handle shows in the detail', first({ text: t }).detail.includes('@hoge_jp'));
  check('a bare profile is only a link', acts({ text: 'https://x.com/hoge_jp' }).join() === 'link');
  check('a search URL is only a link', acts({ text: 'https://x.com/search?q=%E3%81%A7%E3%81%99%E3%81%AD' }).join() === 'link');
  check('parseXStatus rejects a photo sub-path? no — it keeps the id',
    D.parseXStatus('https://x.com/a/status/1798512345678901234/photo/1')?.id === '1798512345678901234');
}

console.log('\n══ subtitles: cues, not prose ══');
{
  // Real jimaku .srt shape, including the CRLF and the 0-padded hours.
  const srt = [
    '1', '00:00:01,000 --> 00:00:03,500', 'おはようございます。', '',
    '2', '00:00:03,600 --> 00:00:06,000', 'today は日本語で話します。', '',
  ].join('\n');
  check('a pasted .srt body → 字幕を取り込む', first({ text: srt }).action === 'subtitle');
  // Verbatim apart from surrounding whitespace — a dragged .srt often arrives
  // with a BOM-ish blank first line, and the cue parser wants neither.
  check('the payload carries the whole body', first({ text: srt }).payload.srt === srt.trim());
  check('the detail counts the cues', first({ text: srt }).detail === '2行のキュー');
  check('.vtt dot-milliseconds parse too',
    D.looksLikeSubtitle('00:00:01.000 --> 00:00:03.500\nあ\n00:00:04.000 --> 00:00:05.000\nい'));
  // One arrow in a note is an arrow. Two clocked ones are a subtitle file.
  check('prose containing an arrow is NOT a subtitle',
    !D.looksLikeSubtitle('つまり A --> B ということですね。'));
  check('a single cue line is NOT enough',
    !D.looksLikeSubtitle('00:00:01,000 --> 00:00:03,500\nおはよう'));
  check('a dropped .srt FILE is a subtitle', first({ files: [{ name: '進撃の巨人.S01E01.ja.srt' }] }).action === 'subtitle');
  check('…and the episode name survives, language tag stripped',
    first({ files: [{ name: '進撃の巨人.S01E01.ja.srt' }] }).payload.title === '進撃の巨人.S01E01');
  check('.vtt files too', first({ files: [{ name: 'ep2.vtt' }] }).action === 'subtitle');
}

console.log('\n══ watch history: a Takeout export is a batch, not a phrase ══');
{
  const json = JSON.stringify([
    { titleUrl: 'https://www.youtube.com/watch?v=0z91Gp-V8fE', time: '2026-01-01T00:00:00Z' },
    { titleUrl: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', time: '2026-01-02T00:00:00Z' },
  ]);
  check('Takeout JSON → 視聴履歴', first({ text: json }).action === 'history');
  check('one stray watch URL inside prose is not a history export',
    !acts({ text: 'これ見た https://www.youtube.com/watch?v=0z91Gp-V8fE' }).includes('history'));
}

console.log('\n══ images: OCR only when OCR exists ══');
{
  const two = [{ name: 'a.png', type: 'image/png' }, { name: 'b.jpg', type: 'image/jpeg' }];
  check('no vision key → only トレイ', acts({ files: two }).join() === 'image-tray');
  check('with a vision key → OCR leads', acts({ files: two }, { surface: 'tray', can: { ocr: true } })[0] === 'image-ocr');
  check('…and plain トレイ is still offered underneath',
    acts({ files: two }, { surface: 'tray', can: { ocr: true } }).includes('image-tray'));
  check('the count is in the label detail', first({ files: two }).detail === '2枚をそのまま保管');
  check('a HEIC screenshot counts as an image even with no MIME',
    first({ files: [{ name: 'IMG_0042.HEIC' }] }).action === 'image-tray');
  check('a file we have no verb for still lands somewhere (§28 S6)',
    first({ files: [{ name: 'notes.pdf', type: 'application/pdf' }] }).action === 'tray');
}

console.log('\n══ text: the surface adds a verb, it never reorders the specific ones ══');
{
  const line = 'カッシーラーっていう人がいるんですけど。';
  check('a Japanese sentence leads with ⚡分類', first({ text: line }).action === 'capture');
  check('on an OPEN ENTRY, 用例 comes first', first({ text: line }, { surface: 'entry', entryKey: 'んですけど' }).action === 'attest');
  check('…and 分類 is still right behind it',
    acts({ text: line }, { surface: 'entry', entryKey: 'んですけど' })[1] === 'capture');
  check('the entry key is quoted in the 用例 detail',
    first({ text: line }, { surface: 'entry', entryKey: 'んですけど' }).detail.includes('んですけど'));
  check('an entry surface with NO open entry offers no 用例',
    !acts({ text: line }, { surface: 'entry' }).includes('attest'));
  check('a short word also offers 辞書', acts({ text: '割り切る' }).includes('lookup'));
  check('a whole sentence does NOT offer 辞書 (nothing to look up)', !acts({ text: line }).includes('lookup'));
  check('X search only when X is configured', !acts({ text: line }).includes('x-search'));
  check('…offered when it is', acts({ text: line }, { surface: 'x', can: { x: true } }).includes('x-search'));
  check('トレイ is always the last resort', acts({ text: line }).at(-1) === 'tray');
  // English carried in from Notes is a WANT, not a catalog entry in a language
  // it isn't written in (§27.0.2).
  check('English → 願い', first({ text: 'that feeling when you almost say it' }).action === 'reach');
  check('English never offers 分類', !acts({ text: 'plausible deniability' }).includes('capture'));
  check('…but does offer トレイ', acts({ text: 'plausible deniability' }).includes('tray'));
  check('empty text yields nothing at all', acts({ text: '   ' }).length === 0);
  // Dragging a note out of Obsidian's own file explorer hands us a wikilink.
  // Claiming that drop would break Obsidian's link-insert for no gain.
  check('a bare wikilink yields nothing — the router lets Obsidian have it',
    acts({ text: '[[Transcripts/ゆる言語学ラジオ 第100回]]' }).length === 0);
  check('an embed wikilink too', acts({ text: '![[Transcripts/x.md#^recon-1]]' }).length === 0);
  check('…but a sentence that merely CONTAINS a link is still a phrase',
    first({ text: 'ここ見て [[メモ]] っていう話ですね。' }).action === 'capture');
}

console.log('\n══ the preview pass: vague, but the target you aim at still exists ══');
{
  // Mid-drag the browser hands you `types` and nothing else. The cards drawn
  // then must survive into the concrete pass or the drop lands on a target
  // that has ceased to exist.
  const line = 'カッシーラーっていう人がいるんですけど。';
  const ctx = { surface: 'entry', entryKey: 'んですけど' };
  const previewed = acts({ preview: true, kinds: ['text/plain'] }, ctx);
  const real = acts({ text: line }, ctx);
  check('preview offers 用例 first on an open entry', previewed[0] === 'attest');
  check('every previewed target survives into the real pass',
    previewed.every((a) => real.includes(a)), `${previewed} vs ${real}`);
  check('a dragged link previews as a generic link verb',
    acts({ preview: true, kinds: ['text/uri-list', 'text/plain'] })[0] === 'link');
  check('…and says so honestly rather than guessing YouTube',
    D.dropIntents({ preview: true, kinds: ['text/uri-list'] }, { surface: 'lexicon' })[0].detail.includes('自動で振り分け'));
  check('a previewed image drag knows it is an image (MIME survives)',
    acts({ preview: true, kinds: ['Files'], files: [{ type: 'image/png' }] })[0] === 'image-tray');
  check('…without inventing a filename', first({ preview: true, kinds: ['Files'], files: [{ type: 'image/png' }] }).detail === '画像をそのまま保管');
}

console.log('\n══ uri-list beats text/plain (Safari sends both, text is the title) ══');
{
  const i = D.dropIntents({
    uriList: 'https://youtu.be/0z91Gp-V8fE\n',
    text: '【ゆる言語学ラジオ】カッシーラーの話',
  }, { surface: 'lexicon' });
  check('the link wins over its own title text', i[0].action === 'yt-transcript');
  check('comment lines in a uri-list are skipped',
    D.firstUri('# a comment\nhttps://x.com/a/status/123456789\n') === 'https://x.com/a/status/123456789');
  check('an empty uri-list is null', D.firstUri('') === null);
}

console.log('\n══ the synthetic carry routes identically to a real drag ══');
{
  // `pointer-drag.ts` exists because iPhone WebKit never fires `dragstart`, so
  // the drop router grew a second entry point. The gesture is only ONE gesture
  // if both entry points reach the same verbs (§26.0 property 4) — a drop that
  // meant something different depending on which transport delivered it would
  // be a seam the user has to learn.
  //
  // This is the sample `attachDropRouter`'s zone builds from a `DragPayload`.
  const carried = (text) => ({ text, kinds: ['text/plain', 'text/html', 'application/x-jpc-drag'], files: [] });

  for (const [what, text] of [
    ['a phrase', 'どっかのタイミングで'],
    ['a YouTube link', 'https://www.youtube.com/watch?v=0z91Gp-V8fE'],
    ['a timed link', 'https://youtu.be/0z91Gp-V8fE?t=65'],
    ['an X post', 'https://x.com/someone/status/1234567890123456789'],
  ]) {
    for (const surface of ['lexicon', 'dict', 'tray', 'x']) {
      const ctx = { surface };
      check(`${what} on ${surface}: carried === dragged`,
        JSON.stringify(acts(carried(text), ctx)) === JSON.stringify(acts({ text }, ctx)),
        `${JSON.stringify(acts(carried(text), ctx))} vs ${JSON.stringify(acts({ text }, ctx))}`);
    }
  }
  // An open entry is the case where the surface DOES change the answer, and it
  // has to change it the same way for both transports.
  const entry = { surface: 'entry', entryKey: 'ですね' };
  check('on an open entry too',
    JSON.stringify(acts(carried('言われてみればそうですね'), entry))
      === JSON.stringify(acts({ text: '言われてみればそうですね' }, entry)));

  // The carry always has text — an empty one is declined before it starts
  // (`bindPointerDrag` refuses a payload whose text is blank), and the router
  // must not offer anything for one either.
  check('an empty carry offers nothing', acts(carried('')).length === 0);
}

console.log('══ 宛名札 — the address line says exactly what release does (§2.2) ══');
{
  const rack = [
    { action: 'capture', icon: '⚡', label: '分類して台帳へ', payload: {} },
    { action: 'tray', icon: '⤵', label: 'トレイへ', payload: {} },
  ];
  check('an aimed card is the address, named with its surface',
    D.atenaFor(rack, 1, 'dict') === '→ 辞書 ・ ⤵ トレイへ',
    D.atenaFor(rack, 1, 'dict'));
  check('no aim yet → the default runs, and the line SAYS it is the default',
    D.atenaFor(rack, -1, 'x') === '→ 𝕏検索 ・ ⚡ 分類して台帳へ（既定）',
    D.atenaFor(rack, -1, 'x'));
  check('an empty rack is the honest nothing',
    D.atenaFor([], 0, 'tray') === '着地なし — 離すと戻る');
  check('an out-of-range aim falls back to the default, marked as such',
    D.atenaFor(rack, 9, 'tray').includes('（既定）'));
}

console.log(`\n${fail === 0 ? '✓' : '✗'} drop-intent: ${pass}/${pass + fail} checks passed`);
if (fail) process.exitCode = 1;
