/**
 * eijiro.ts — the PURE 英辞郎 adapter (DESIGN §27.7 step 1).
 *
 * §27.1: Eijiro is not "big", it is a *production* dictionary — 85% of entries
 * are phrases, `〔…〕` is a production-condition rather than a definition, and
 * `be ～` / `a ～` / `$__` are the plugin's own slot notation pre-drawn. So the
 * adapter's job is NOT to import rows; it is to finish the inversion the source
 * already started, emitting `ReachCandidate`s that are catalog objects at the
 * curated stratum (§27.6) keyed in the shared frame space (`frames.ts`).
 *
 * Two corrections to §27, found by reading the user's actual export rather than
 * the manifesto:
 *
 *  1. **There is no SVL.** §27.4 planned SVL→production-priority; `definitionTags`
 *     and `termTags` are empty on every entry sampled. Priority must come from
 *     elsewhere. Nothing here pretends otherwise.
 *  2. **Glossary content is an HTML STRING**, not a Yomitan structured-content
 *     node tree — this converter emitted markup. The vocabulary is small and
 *     closed (`entry-header`, `pos-tag`, `senses`, `sense`, `sense-pos`, `xref`,
 *     `supplement`, `label`), which is why regex parsing is safe here and would
 *     not be for general structured content. `YomitanImporter` keeps handling
 *     the node-tree case for every other dictionary.
 *
 * PURE — no Obsidian, no DOM, no I/O. Golden: golden/eijiro.mjs, run against
 * real entries lifted verbatim from the user's export.
 */

import type { NoteClass } from '../notes/note-types.ts';
import { toFrame, normalizeFrame, classHintForFrame, type Frame } from './frames.ts';

/** Raw Yomitan v3 term tuple. */
export type EijiroTuple = [
  string,            // 0 expression
  string,            // 1 reading
  string,            // 2 definitionTags  (always "" in this export)
  string,            // 3 rules           ("", n, 人名, comb, suf, adj)
  number,            // 4 score
  // 5 glossary. 英辞郎's converter only ever emits structured-content objects,
  // but the Yomitan format also allows a bare string and a deinflection tuple
  // ([uninflected, rules]) — both occur in the user's other dictionaries, so
  // the type says so rather than making every other adapter cast around it.
  Array<string | string[] | { type?: string; content?: unknown; text?: string }>,
  number,            // 6 sequence
  string,            // 7 termTags        (always "" in this export)
];

export interface DictSense {
  pos?: string;
  gloss: string;
  /** the 〔…〕 bracket — a production-CONDITION, not a definition (§27.1). */
  situation?: string;
  /** div.supplement — Eijiro's ◆ note. */
  note?: string;
  xrefs?: string[];
}

/**
 * The production unit — what "reach for this" means, as an object.
 *
 * DIRECTION MATTERS, and getting it backwards is the easy mistake. This is an
 * EN→JP dictionary being used as a *production* dictionary by a speaker of
 * English learning Japanese, so:
 *   intention = the English headword — "the thing I want to say" (the QUERY)
 *   surface   = the Japanese gloss   — "what I actually say"     (the ANSWER)
 * §27.0.1: not translation, one meaning externalized twice. The class and the
 * frame key are therefore computed from the JAPANESE side, because that is the
 * production unit the six classes describe.
 */
export interface ReachCandidate {
  /** English headword — the intention you search by. */
  intention: string;
  /** Japanese — the surface you reach for. */
  surface: string;
  /** declared syntactic shape of the English side: be ～ / a ～ / the ～. */
  shape?: string;
  situation?: string;
  /** normalized key of the JAPANESE surface — joins the catalog's 🟠/💠. */
  frameKey: string;
  /** normalized key of the ENGLISH side — the intention index. */
  intentionKey: string;
  slots: number;
  /** shape-only suggestion; the human tests decide (§13.3/§15). Never 🔴/🟡. */
  classHint: NoteClass;
}

export interface DictHeadword {
  expression: string;
  reading?: string;
  pos: string[];
  /** rules[3]. 'name' entries are deprioritized, never study noise (§27.4). */
  kind?: 'name' | 'comb' | 'suf' | 'adj' | 'n';
  senses: DictSense[];
  reachFor: ReachCandidate[];
  xrefs: string[];
  sequence: number;
}

// ── html helpers (closed vocabulary — see header) ────────────────────────────

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
};

export function stripTags(html: string): string {
  return String(html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** All inner texts of `<tag class="cls">`, in order, deduped consecutively. */
function pick(html: string, tag: string, cls: string): string[] {
  const re = new RegExp(`<${tag}[^>]*class="${cls}"[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const out: string[] = [];
  for (const m of html.matchAll(re)) {
    const t = stripTags(m[1]);
    // Eijiro emits label and xref spans TWICE; a consecutive repeat is that
    // artifact, not two values.
    if (t && out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

/** Remove whole `<tag class="cls">…</tag>` blocks (so gloss text excludes them). */
function drop(html: string, tag: string, cls: string): string {
  return html.replace(new RegExp(`<${tag}[^>]*class="${cls}"[^>]*>[\\s\\S]*?</${tag}>`, 'g'), '');
}

/** Split the 〔situation〕 prefix off a gloss. */
export function splitSituation(text: string): { situation?: string; gloss: string } {
  const m = /〔([^〕]*)〕/.exec(text);
  if (!m) return { gloss: text.trim() };
  return { situation: m[1].trim(), gloss: text.replace(m[0], '').trim() };
}

// ── the adapter ──────────────────────────────────────────────────────────────

const KIND: Record<string, DictHeadword['kind']> = {
  '人名': 'name', 'comb': 'comb', 'suf': 'suf', 'adj': 'adj', 'n': 'n',
};

/** Is the head an evocative lemma (→ 🟢 offered)? Supplied by the caller, since
 *  evocativeness is a property of the WORD, not of this entry (§7 v2 🟢 test). */
export interface AdaptOpts { evocativeHead?: (expression: string) => boolean }

export function adaptEijiroEntry(tuple: EijiroTuple, opts: AdaptOpts = {}): DictHeadword {
  const [expression, reading, , rules, , glossary, sequence] = tuple;
  const html = String(
    (glossary ?? []).map((g) => {
      if (typeof g === 'string') return g;
      if (Array.isArray(g)) return '';                    // deinflection tuple
      return g.content ?? g.text ?? '';
    }).join('\n'),
  );

  const pos = pick(html, 'span', 'pos-tag');
  const xrefs = pick(html, 'span', 'xref').concat(pick(html, 'div', 'xref'))
    .map((x) => x.replace(/^→\s*/, '').trim())
    .filter((x, i, a) => x && a.indexOf(x) === i);

  const senses: DictSense[] = [];

  // multi-sense: <ol class="senses"><li>…</li></ol>
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
  const olMatch = /<ol[^>]*class="senses"[^>]*>([\s\S]*?)<\/ol>/.exec(html);
  if (olMatch) {
    for (const li of olMatch[1].matchAll(liRe)) {
      const raw = li[1];
      const sensePos = pick(raw, 'span', 'sense-pos')[0];
      const note = pick(raw, 'div', 'supplement').join(' ') || undefined;
      let body = drop(drop(drop(raw, 'span', 'sense-pos'), 'div', 'supplement'), 'span', 'xref');
      const { situation, gloss } = splitSituation(stripTags(body).replace(/^＝\s*/, ''));
      senses.push({
        ...(sensePos ? { pos: sensePos } : {}),
        gloss, ...(situation ? { situation } : {}), ...(note ? { note } : {}),
      });
    }
  }

  // single sense: <div class="sense">…</div> (+ sibling supplements)
  const labelsFor = new Map<number, string[]>();
  const senseRe = /<div[^>]*class="sense"[^>]*>([\s\S]*?)<\/div>/g;
  let si = 0;
  for (const m of html.matchAll(senseRe)) {
    const raw = m[1];
    const labels = pick(raw, 'span', 'label');
    labelsFor.set(si, labels);
    const body = drop(drop(raw, 'span', 'label'), 'span', 'xref');
    const { situation, gloss } = splitSituation(stripTags(body).replace(/^＝\s*/, ''));
    const note = pick(html, 'div', 'supplement').join(' ') || undefined;
    senses.push({
      ...(pos[0] ? { pos: pos[0] } : {}),
      gloss, ...(situation ? { situation } : {}), ...(note ? { note } : {}),
    });
    si++;
  }

  // ── the inversion: which of this entry's senses are REACH-FOR units? ──
  const evocative = opts.evocativeHead?.(expression) ?? false;
  const reachFor: ReachCandidate[] = [];
  senses.forEach((s, i) => {
    // A name is a name: never a production candidate, never study noise (§27.4).
    if (KIND[rules] === 'name') return;
    // No Japanese side = nothing to reach for (an xref-only stub).
    if (!s.gloss) return;
    const shape = labelsFor.get(i)?.[0];
    // The production unit is the JAPANESE surface; the English headword is the
    // intention you search by. The class and frame come from the Japanese.
    const frame: Frame = toFrame(s.gloss, shape);
    const intention: Frame = toFrame(expression, shape);
    // What earns a place in the reach-for index: §27.1's unit is the
    // EXPRESSION-in-use. A multi-word intention is an expression ("how do I say
    // 'dollar store'"); a single word answered by a single word is an ordinary
    // look-up and the dictionary path already serves it. Slots, 〔situations〕
    // and declared shapes always qualify.
    const isExpression = /\s/.test(expression.trim());
    if (frame.fixed && !s.situation && !shape && !evocative && !isExpression) return;
    reachFor.push({
      intention: expression,
      surface: s.gloss,
      ...(shape ? { shape } : {}),
      ...(s.situation ? { situation: s.situation } : {}),
      frameKey: frame.key,
      intentionKey: intention.key,
      slots: frame.slots.length,
      classHint: classHintForFrame(frame, {
        situation: !!s.situation, evocativeHead: evocative,
      }) as NoteClass,
    });
  });

  return {
    expression,
    ...(reading ? { reading } : {}),
    pos,
    ...(KIND[rules] ? { kind: KIND[rules] } : {}),
    senses, reachFor, xrefs, sequence,
  };
}

/** Convenience: adapt a whole term bank, dropping entries with no glossary. */
export function adaptEijiroBank(bank: EijiroTuple[], opts: AdaptOpts = {}): DictHeadword[] {
  const out: DictHeadword[] = [];
  for (const t of bank) {
    if (!Array.isArray(t) || !t[5]?.length) continue;
    out.push(adaptEijiroEntry(t, opts));
  }
  return out;
}

/**
 * The reach-for index: frameKey → candidates. This is the structure the
 * production entry points (§27.2 "by frame", "by situation") query, and the one
 * the user's own 🟠/💠 catalog entries join into by sharing `normalizeFrame`.
 */
export function buildFrameIndex(heads: DictHeadword[]): Map<string, ReachCandidate[]> {
  const idx = new Map<string, ReachCandidate[]>();
  for (const h of heads) {
    for (const c of h.reachFor) {
      const k = normalizeFrame(c.frameKey);
      const list = idx.get(k);
      if (list) list.push(c); else idx.set(k, [c]);
    }
  }
  return idx;
}
