/**
 * golden/capture-frontmatter.mjs — the YAML shape a capture note MUST have.
 *
 * The ⚡ flow silently refused to run on notes it had itself just created.
 * `PipelineView.ensureCaptureNote` wrote:
 *
 *     ---
 *     source: [[動画タイトル (VIDEOID)]]
 *     ---
 *
 * In YAML, `[` opens a flow sequence, so `[[X]]` is a NESTED SEQUENCE and that
 * line parses to `{source: [["X"]]}` — an array of arrays. The wikilink never
 * exists as a string, so Obsidian records no link, `metadataCache.resolvedLinks`
 * stays empty for the note, and `findCaptureNote()` — which searched
 * resolvedLinks — returned null for a file sitting right there on disk. The UI
 * then said "add a photo or phrase" above a memo containing the user's photo,
 * and ⚡ refused with a Notice that blamed the user.
 *
 * Nothing caught it because every other writer in the plugin quotes the link,
 * and no test ever compared them. This suite does exactly that.
 *
 * Run:  node golden/capture-frontmatter.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const YAML = require('js-yaml');
const P = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'pipeline.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`); }
};

const TITLE = '哲学って学ぶ意味ある？ (DHE-S7rfuO0)';
const fm = (body) => `---\n${body}\n---\n\n`;
const yamlOf = (note) => YAML.load(note.match(/^---\n([\s\S]*?)\n---/)[1]);

const BROKEN = fm(`source: [[${TITLE}]]`);                 // what the bug wrote
const FIXED = fm(`sources:\n  - "[[${TITLE}]]"`);          // what every other writer writes

console.log('\n══ why the bug existed — unquoted [[…]] is not a link in YAML ══');
{
  const v = yamlOf(BROKEN).source;
  check('unquoted [[X]] parses as a NESTED ARRAY, not a string',
    Array.isArray(v) && Array.isArray(v[0]), JSON.stringify(v));
  check('…so no wikilink string survives for Obsidian to resolve',
    typeof v !== 'string' && !JSON.stringify(v).includes('[[' + TITLE));
}

console.log('\n══ the shape every writer must emit ══');
{
  const v = yamlOf(FIXED).sources;
  check('quoted "[[X]]" survives as a string', Array.isArray(v) && typeof v[0] === 'string', JSON.stringify(v));
  check('the string is a real wikilink', v[0] === `[[${TITLE}]]`);
  check('the key is the plural `sources`', 'sources' in yamlOf(FIXED));
  check('a title with ？ and parens round-trips intact',
    v[0].includes('？') && v[0].includes('(DHE-S7rfuO0)'));
}

console.log('\n══ both shapes still reach the pipeline (old notes keep working) ══');
{
  // frontmatterSources reads raw text with a regex, not YAML — which is why the
  // broken notes still RAN even while the view could not find them. Pin that,
  // so healing them can never be mistaken for a behaviour change.
  check('broken shape still resolves to the transcript', P.frontmatterSources(BROKEN)[0] === TITLE,
    P.frontmatterSources(BROKEN)[0]);
  check('fixed shape resolves to the transcript', P.frontmatterSources(FIXED)[0] === TITLE,
    P.frontmatterSources(FIXED)[0]);
  check('both agree', P.frontmatterSources(BROKEN)[0] === P.frontmatterSources(FIXED)[0]);
}

console.log('\n══ the in-place repair (PipelineView.healFrontmatter) ══');
{
  // Mirrored from the implementation.
  const heal = (md) => {
    const m = md.match(/^(﻿?---\r?\n)([\s\S]*?)(\r?\n---)/);
    if (!m) return md;
    const fixed = m[2].replace(
      /^([^\S\r\n]*)source:[^\S\r\n]*(\[\[[^\]\r\n]+\]\])[^\S\r\n]*$/m,
      (_a, indent, link) => `${indent}sources:\n${indent}  - "${link}"`);
    return fixed === m[2] ? md : md.replace(m[0], m[1] + fixed + m[3]);
  };
  const healed = heal(BROKEN);
  check('repair produces the canonical shape', healed === FIXED, JSON.stringify(healed.slice(0, 48)));
  check('repair is idempotent', heal(healed) === healed);
  check('repair leaves an already-correct note untouched', heal(FIXED) === FIXED);

  // Narrowness: anything the user has since edited must be left alone.
  const USER_EDITED = fm(`source: [[${TITLE}]]\ntags: [study]\nnote: mine`);
  check('unrelated frontmatter keys survive the repair',
    heal(USER_EDITED).includes('tags: [study]') && heal(USER_EDITED).includes('note: mine'));
  const MULTILINE = fm(`source:\n  - "[[${TITLE}]]"`);
  check('a list-shaped `source:` is not rewritten', heal(MULTILINE) === MULTILINE);
  check('body content is never touched',
    heal(BROKEN + '![[photo.png]]\n').endsWith('![[photo.png]]\n'));
}

console.log('\n══ many videos, one memo — merging sources into a day-memo ══');
{
  // Mirrored from PipelineView.syncFrontmatter.
  const A = '動画A (aaaaaaaaaaa)', B = '動画B (bbbbbbbbbbb)', C = '動画C (ccccccccccc)';
  const existingSources = (md) => {
    const f = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
    return f ? [...f[1].matchAll(/\[\[([^\]\r\n]+)\]\]/g)].map((m) => m[1]) : [];
  };
  const sync = (md, sel) => {
    const m = md.match(/^(﻿?---\r?\n)([\s\S]*?)(\r?\n---)/);
    if (!m) return md;
    let block = m[2].replace(
      /^([^\S\r\n]*)source:[^\S\r\n]*(\[\[[^\]\r\n]+\]\])[^\S\r\n]*$/m,
      (_a, indent, link) => `${indent}sources:\n${indent}  - "${link}"`);
    const have = new Set(existingSources(m[1] + block + m[3]));
    const missing = sel.filter((t) => !have.has(t));
    if (missing.length) {
      const add = missing.map((t) => `  - "[[${t}]]"`).join('\n');
      block = /^[^\S\r\n]*sources:/m.test(block)
        ? block.replace(/^([^\S\r\n]*sources:[^\n]*(?:\n[^\S\r\n]+-[^\n]*)*)/m, `$1\n${add}`)
        : `sources:\n${add}\n${block}`.replace(/\n+$/, '');
    }
    return block === m[2] ? md : md.replace(m[0], m[1] + block + m[3]);
  };

  const one = fm(`sources:\n  - "[[${A}]]"`);
  const two = sync(one, [A, B]);
  check('a second video is appended, not replaced',
    existingSources(two).join(',') === `${A},${B}`, existingSources(two).join(','));
  const three = sync(two, [A, B, C]);
  check('a third appends after the second', existingSources(three).join(',') === `${A},${B},${C}`);
  check('re-selecting the same videos changes nothing (idempotent)', sync(three, [A, B, C]) === three);
  check('adding a video already listed is a no-op', sync(three, [B]) === three);

  // A legacy note must upgrade AND merge in the same pass.
  const legacy = fm(`source: [[${A}]]`);
  const upgraded = sync(legacy, [A, B]);
  check('legacy single-line note upgrades and merges in one pass',
    existingSources(upgraded).join(',') === `${A},${B}` && /sources:/.test(upgraded),
    existingSources(upgraded).join(','));
  check('the upgraded note has no bare `source:` line left',
    !/^\s*source:\s*\[\[/m.test(upgraded));

  // Other frontmatter keys must survive a merge.
  const withKeys = fm(`sources:\n  - "[[${A}]]"\ntags: [study]`);
  const merged = sync(withKeys, [A, B]);
  check('keys after the sources list survive the merge', /tags: \[study\]/.test(merged));
  check('the merged link lands inside the list, not after tags',
    merged.indexOf(`[[${B}]]`) < merged.indexOf('tags:'), 'order preserved');
}

console.log(`\n${fail ? '✗' : '✓'} capture-frontmatter: ${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
