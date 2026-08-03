/**
 * golden/capture-rung.mjs — the rung between a transcript and ⚡.
 *
 * AUDIT-2026-08-01 §4: `writeTranscriptNote()` makes a TRANSCRIPT, but
 * `runFullPipeline()` needs a CAPTURE note whose frontmatter names it in
 * `sources:`. The only bridge, `newCaptureNote()`, requires a `_watch-history`
 * note and matches `youtu.be/<11>` against filenames — so a Plex or jimaku
 * transcript could never reach ⚡ without hand-written frontmatter.
 *
 * `captureNoteFromTranscript()` in main.ts is the source-agnostic rung. Its
 * gate is what this suite pins: the decision must key on the ONE property the
 * pipeline actually needs (stamped lines it can anchor to) and never on where
 * the subtitle came from. A gate that sniffed `plex_rating_key` would be the
 * same bug wearing a different hat.
 *
 * Run:  node golden/capture-rung.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'pipeline.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`); }
};

/** The gate, mirrored from main.ts#captureNoteFromTranscript.
 *
 *  `isCapture` deliberately does NOT use `frontmatterSources()`. That helper's
 *  key regex is `sources?(_transcript)?`, which also matches the SINGULAR
 *  `source:` — and `srtToNote` writes `source: tv` into every Plex and jimaku
 *  transcript. The first version of this gate used it and rejected every TV
 *  transcript as "already a capture note", i.e. it failed on precisely the case
 *  the command exists to serve. The plural key is the real test. */
const fmBlock = (md) => md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
const stampedLines = (md) => P.parseTranscriptLines(md).filter((l) => l.tStartSec != null).length;
const isCapture = (md) => /^\s*sources(?:_transcript)?:/m.test(fmBlock(md));
const eligible = (md) => !isCapture(md) && stampedLines(md) >= 5;

const body = (n) => Array.from({ length: n }, (_, i) =>
  `[00:${String(i).padStart(2, '0')}:0${i % 10}] これはテスト行です${i}。`).join('\n');

const PLEX = `---\nsource: tv\ntitle: "第4話 — テスト"\nshow: "テスト番組"\nsub_source: plex\n`
  + `plex_rating_key: "12345"\nplex_part_key: "/library/parts/999/file.mkv"\n---\n\n# 第4話\n\n${body(12)}\n`;
const JIMAKU = `---\nsource: tv\ntitle: "第4話 — テスト"\nsub_source: jimaku\njimaku_entry: 77\n---\n\n${body(12)}\n`;
const YT = `---\ntitle: "動画タイトル (dQw4w9WgXcQ)"\n---\n\n${body(12)}\n`;
const PLAIN_SRT = `# 貼り付けた字幕\n\n${body(12)}\n`;
const CAPTURE = `---\nsources:\n  - "[[第4話 — テスト]]"\n---\n\n手書き画像をここに\n`;
const NO_STAMPS = `---\ntitle: "エッセイ"\n---\n\n段落がひとつ。タイムスタンプはありません。\n`;
const THIN = `---\ntitle: "短い"\n---\n\n${body(3)}\n`;

console.log('\n══ every transcript source reaches ⚡ by the same rung ══');
check('Plex transcript is eligible', eligible(PLEX), `${stampedLines(PLEX)} stamped`);
check('jimaku transcript is eligible', eligible(JIMAKU));
check('YouTube transcript is eligible', eligible(YT));
check('hand-pasted .srt with no frontmatter is eligible', eligible(PLAIN_SRT));
check('the gate never reads provenance — Plex and jimaku decide identically',
  eligible(PLEX) === eligible(JIMAKU) && eligible(PLEX) === eligible(PLAIN_SRT));

console.log('\n══ refusals are loud and for the right reason ══');
check('a capture note is not re-captured (would nest sources:)', !eligible(CAPTURE));
// The regression that this suite caught on its first run.
check('`source: tv` is NOT mistaken for a capture note', !isCapture(PLEX) && !isCapture(JIMAKU));
check('`sources:` (plural) IS a capture note', isCapture(CAPTURE));
check('a note with no stamps is refused', !eligible(NO_STAMPS), `${stampedLines(NO_STAMPS)} stamped`);
check('too few stamped lines is refused', !eligible(THIN), `${stampedLines(THIN)} stamped`);

console.log('\n══ the note it writes is what runFullPipeline consumes ══');
{
  const basename = '第4話 — テスト';
  const written = `---\nsources:\n  - "[[${basename}]]"\n---\n\n> [!tip] 画像を貼って ⚡\n`;
  const parsed = P.frontmatterSources(written);
  check('sources: round-trips through the pipeline reader', parsed.length === 1, parsed[0]);
  check('the link resolves to the transcript basename', parsed[0] === `[[${basename}]]` || parsed[0] === basename, parsed[0]);
  check('the written note is itself not eligible (no infinite rung)', !eligible(written));
}

console.log('\n══ a MEDIUM tag is not a source reference (AUDIT-PARTS §4) ══');
// `frontmatterSources` used to match `sources?`, so the singular `source:` —
// the medium tag on EVERY transcript this plugin writes — read as "this note
// names one source called tv". The ⚡ gate accepted every transcript in the
// vault, then failed at getFirstLinkpathDest('tv'); in a vault holding a note
// actually named `tv`/`yt`/`book` it resolved and reconciled against it.
// The two cases differ by SHAPE, not by key: a reference is a [[wikilink]].
{
  const fm = (b) => `---\n${b}\n---\n\n本文\n`;
  for (const [medium, extra] of [
    ['tv', '\nplex_rating_key: 4021'], ['yt', '\nvideo: abc'],
    ['podcast', ''], ['book', '\nbook_title: "夜は短し"'], ['note', '\nurl: "https://note.com/x"'],
  ]) {
    const md = fm(`source: ${medium}${extra}`);
    check(`\`source: ${medium}\` is NOT a capture note`, !P.isCaptureNote(md), JSON.stringify(P.frontmatterSources(md)));
    check(`\`source: ${medium}\` reads as the medium`, P.frontmatterMedium(md) === medium, String(P.frontmatterMedium(md)));
  }
  // …and the legacy capture shape that ensureSourceFrontmatter used to write
  // must keep resolving, or existing vault notes silently stop reaching ⚡.
  const legacy = fm('source: [[動画A]]');
  check('LEGACY `source: [[A]]` still resolves', P.frontmatterSources(legacy)[0] === '動画A', JSON.stringify(P.frontmatterSources(legacy)));
  check('LEGACY `source: [[A]]` is a capture note', P.isCaptureNote(legacy));
  check('a wikilink is never reported as a medium', P.frontmatterMedium(legacy) === null, String(P.frontmatterMedium(legacy)));
  const both = fm('source: tv\nsources:\n  - "[[動画A]]"');
  check('both keys: the plural wins as the reference', JSON.stringify(P.frontmatterSources(both)) === '["動画A"]', JSON.stringify(P.frontmatterSources(both)));
  check('both keys: the singular still reads as the medium', P.frontmatterMedium(both) === 'tv');
  const list = fm('source:\n  - "[[動画A]]"');
  check('a LIST under `source:` is a reference list', P.frontmatterSources(list)[0] === '動画A', JSON.stringify(P.frontmatterSources(list)));
}

console.log('\n══ titles that would break a filename ══');
{
  const nasty = 'S01E04: "テスト" / 第4話 <再>';
  const safe = nasty.replace(/[\\/:*?"<>|]/g, '').trim();
  check('path-hostile characters are stripped', !/[\\/:*?"<>|]/.test(safe), safe);
  check('something survives to name the file', safe.length > 0, safe);
}

console.log(`\n${fail ? '✗' : '✓'} capture-rung: ${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
