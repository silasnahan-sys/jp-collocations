// relational.ts — the "B" layer: skeletal component reading → discourse-thought
// tree (→ sequential / ↳ elaboration / ↧ block pivot) → emergent move + tone.
//
// GOVERNING RULE (see memory: discourse-skeleton-principle): this layer reads
// SKELETON, not content substance. Every component, relation, and named move
// must trace back to a skeletal marker or a licensed composition of them. Tone
// is emitted only when it falls out of the formation. If a reading would need
// topic comprehension, it is not produced here.
//
// Component-first: components are detected and labelled BEFORE any move is named.
// Built and graded against the user's golds (自分語り Moving-parts; trolley
// re-characterization). Consumes engine sentence text; pairs with analyze.mjs.

/** A detected skeletal component: a function word / framing marker + its
 *  contextual function label. */
export interface SkeletalComponent {
  off: number;
  surface: string;
  fn: string;
}

/** A beat = one sequential phase of a discourse-thought (→ between beats). */
export interface Beat {
  comps: SkeletalComponent[];
  move: string;
  tone: string;
}

/** A block = one discourse-thought: a head (1+ → beats) plus ↳ elaborations.
 *  Blocks are separated by ↧ (a PIVOT-RESUME / topic resumption). */
export interface Block {
  head: Beat[];
  children: Beat[];   // ↳ elaborations of the head
  emergentMove: string;
  tone: string;
}

// ── B-lex: skeletal markers → contextual function. Longest-first, greedy,
//    non-overlapping. Only function/framing morphology — never content words. ──
const LEX: ReadonlyArray<readonly [string, string]> = [
  // recognition / realization formula (a composed cluster)
  ['っていうことだったんだ', 'RECOG-FORMULA'], ['そういうことだったんだ', 'RECOG-FORMULA'],
  ['ことだったんだ', 'RECOG-FORMULA'], ['なるほど', 'UPTAKE-RECOG'],
  // quotative-manner frame
  ['っていう風に', 'QUOT-MANNER'], ['という風に', 'QUOT-MANNER'], ['ていう風に', 'QUOT-MANNER'],
  ['いう風に', 'QUOT-MANNER'], ['みたいに', 'QUOT-MANNER'],
  // analogy / prior-reference / confirm-seek
  ['に近い', 'ANALOGY-NEAR'], ['に似てる', 'ANALOGY-NEAR'],
  ['さっきの', 'ANAPHOR-PRIOR'], ['さっき', 'ANAPHOR-PRIOR'], ['先の', 'ANAPHOR-PRIOR'],
  ['例えである', 'EXEMPLAR-CITE'], ['である', 'COPULA-CITE'],
  ['っていうこと', 'CONFIRM-SEEK'], ['言ったら', 'SUPPOSE'], ['ゆったら', 'SUPPOSE'],
  // citation frame
  ['と言いますけど', 'CITE-FRAME'], ['と言います', 'CITE-FRAME'], ['と言われ', 'CITE-FRAME'],
  ['っていう', 'QUOTATIVE'], ['という', 'QUOTATIVE'],
  // explanatory assertion
  ['んですよ', 'EXPLAIN-ASSERT'], ['んです', 'EXPLAIN-ASSERT'], ['のです', 'EXPLAIN-ASSERT'], ['のだ', 'EXPLAIN-ASSERT'],
  // tentative-negative hedge (the deflator's partner)
  ['んじゃないか', 'TENTATIVE-NEG'], ['じゃないか', 'TENTATIVE-NEG'], ['のではないか', 'TENTATIVE-NEG'],
  // doubt / interest state
  ['気になってます', 'DOUBT-STATE'], ['気になって', 'DOUBT-STATE'], ['気になる', 'DOUBT-STATE'],
  // stance / conjunction
  ['と共に', 'CONJ-ALONGSIDE'], ['感じる', 'STANCE-FEEL'], ['思います', 'STANCE-THINK'],
  ['思う', 'STANCE-THINK'], ['気がする', 'STANCE-SEEM'],
  // now / temporal reframe
  ['今になって', 'NOW-FRAME'], ['今では', 'NOW-FRAME'],
  // pivot / resume
  ['それで', 'PIVOT-RESUME'], ['で、', 'PIVOT-RESUME'],
  // uptake / learning (te-form 教わって is continuative, NOT a beat end)
  ['教わって', 'UPTAKE-LEARN'], ['教わった', 'UPTAKE-LEARN'], ['習った', 'UPTAKE-LEARN'],
  // purpose / directive
  ['ためにも', 'PURPOSE'], ['ために', 'PURPOSE'], ['なさい', 'DIRECTIVE'],
  // causal
  ['そうだから', 'CAUSAL'], ['だから', 'CAUSAL'], ['から', 'CAUSAL'], ['ので', 'CAUSAL'],
  // concession / conditional / exemplify
  ['けれども', 'CONCESS'], ['けど', 'CONCESS'], ['でも', 'CONCESS'], ['ても', 'CONCESS-IF'], ['いくら', 'CONCESS-IF'],
  ['なければ', 'COND'], ['れば', 'COND'], ['たら', 'COND'], ['なら', 'COND'],
  ['とか', 'EXEMPLIFY'], ['など', 'EXEMPLIFY'],
  // minimizer
  ['だけ', 'MINIMIZER'], ['しか', 'MINIMIZER'], ['ばかり', 'MINIMIZER'],
  // nominalize
  ['ってこと', 'NOMINALIZE'], ['ということ', 'NOMINALIZE'], ['こと', 'NOMINALIZE'],
  // anaphor
  ['そういう', 'ANAPHOR-CLASS'], ['それを', 'ANAPHOR'], ['それ', 'ANAPHOR'], ['その', 'ANAPHOR'], ['これ', 'ANAPHOR'],
  // hedge fillers
  ['なんか', 'HEDGE'], ['あの', 'HEDGE'], ['えっと', 'HEDGE'], ['まあ', 'HEDGE'], ['ま、', 'HEDGE'],
];
const LEX_SORTED = [...LEX].sort((a, b) => b[0].length - a[0].length);

/** Detect skeletal components in one sentence (component-first). */
export function components(text: string): SkeletalComponent[] {
  const used = new Array<boolean>(text.length).fill(false);
  const out: SkeletalComponent[] = [];
  for (let i = 0; i < text.length; i++) {
    if (used[i]) continue;
    for (const [surf, fn] of LEX_SORTED) {
      if (text.startsWith(surf, i)) {
        out.push({ off: i, surface: surf, fn });
        for (let k = i; k < i + surf.length; k++) used[k] = true;
        i += surf.length - 1;
        break;
      }
    }
  }
  // FLOOR particles (ね/よ/さ) adjacent to a taken marker or clause end.
  for (let i = 0; i < text.length; i++) {
    if (used[i]) continue;
    if ('ねよさ'.includes(text[i])) {
      const prevTaken = i > 0 && used[i - 1];
      const nextEnd = i === text.length - 1 || '。、'.includes(text[i + 1]);
      if (prevTaken || nextEnd) { out.push({ off: i, surface: text[i], fn: 'FLOOR' }); used[i] = true; }
    }
  }
  // clause-final と handing a proposition forward (suspended narrative).
  const tm = /と[。、]?\s*$/.exec(text);
  if (tm && !used[tm.index]) out.push({ off: tm.index, surface: 'と', fn: 'SUSPEND-NARR' });
  out.sort((a, b) => a.off - b.off);
  return out;
}

// A beat ends after a clause-final predicate followed by more material.
const BEAT_END = new Set(['STANCE-FEEL', 'STANCE-THINK', 'DOUBT-STATE', 'SUSPEND-NARR']);
function splitBeats(comps: SkeletalComponent[]): SkeletalComponent[][] {
  const beats: SkeletalComponent[][] = [];
  let cur: SkeletalComponent[] = [];
  for (let i = 0; i < comps.length; i++) {
    cur.push(comps[i]);
    if (BEAT_END.has(comps[i].fn) && i < comps.length - 1) { beats.push(cur); cur = []; }
  }
  if (cur.length) beats.push(cur);
  return beats.length ? beats : [comps];
}

// ── B-move: name a single beat's formation (skeletal composite → move + tone) ──
function nameBeat(comps: SkeletalComponent[]): { move: string; tone: string } {
  const f = new Set(comps.map((c) => c.fn));
  if (f.has('ANALOGY-NEAR') && (f.has('ANAPHOR-PRIOR') || f.has('EXEMPLAR-CITE') || f.has('ANAPHOR')))
    return { move: 're-characterize-by-analogy', tone: f.has('CONFIRM-SEEK') ? 'tentative-confirming' : 'asserting' };
  if (f.has('MINIMIZER') && f.has('TENTATIVE-NEG')) return { move: 'deflate-to-lesser-ground', tone: 'deflating' };
  if ((f.has('NOW-FRAME') || f.has('RECOG-FORMULA') || f.has('UPTAKE-RECOG')) && (f.has('STANCE-FEEL') || f.has('QUOT-MANNER')))
    return { move: 'earnest-re-appraisal', tone: 'sincere' };
  if (f.has('CITE-FRAME') && (f.has('UPTAKE-LEARN') || f.has('DIRECTIVE'))) return { move: 'ground-a-received-principle', tone: 'authoritative' };
  if (f.has('CONCESS-IF') && f.has('COND')) return { move: 'state-a-conditional-maxim', tone: 'gnomic' };
  if (f.has('ANAPHOR') && f.has('EXPLAIN-ASSERT')) return { move: 'posit-as-shared-ground', tone: 'expository' };
  if (f.has('SUSPEND-NARR')) return { move: 'hand-proposition-as-fact', tone: 'matter-of-fact' };
  if (f.has('CONCESS')) return { move: 'contrastive-turn', tone: 'corrective' };
  return { move: 'assert', tone: 'neutral' };
}

/** Emergent block move = composition of its beat formations, in order. */
function nameBlock(headBeats: Beat[], children: Beat[]): { emergentMove: string; tone: string } {
  const seq = [...headBeats, ...children].map((b) => b.move);
  const has = (m: string) => seq.includes(m);
  if (has('earnest-re-appraisal') && has('deflate-to-lesser-ground'))
    return { emergentMove: 'earnest-realization-undercut-by-doubt', tone: 'sincere→cynical' };
  if (has('posit-as-shared-ground') && has('ground-a-received-principle'))
    return { emergentMove: 'frame-and-ground-a-received-principle', tone: 'earnest-expository' };
  if (seq.length === 1) return { emergentMove: seq[0], tone: [...headBeats, ...children][0].tone };
  return { emergentMove: seq.join(' ▸ '), tone: [...headBeats, ...children].map((b) => b.tone).join('→') };
}

/**
 * The B layer. Takes engine-segmented sentences (text + optional speaker) and
 * returns the discourse-thought blocks with →/↳/↧ structure and named moves.
 *
 * Block boundary (↧) = a sentence that opens with PIVOT-RESUME (で、/それで) or a
 * speaker change. Within a block: the first sentence is the head (its internal
 * beats are → siblings); later same-block sentences are ↳ elaborations.
 */
export function analyzeRelational(sentences: Array<{ text: string; speaker?: string | null }>): Block[] {
  const blocks: Block[] = [];
  let cur: { headRaw: SkeletalComponent[][] | null; childRaw: SkeletalComponent[][]; speaker?: string | null } | null = null;

  const toBeat = (comps: SkeletalComponent[]): Beat => {
    const { move, tone } = nameBeat(comps);
    return { comps, move, tone };
  };
  const finish = () => {
    if (!cur || !cur.headRaw) return;
    const head = cur.headRaw.map(toBeat);
    const children = cur.childRaw.map(toBeat);
    const { emergentMove, tone } = nameBlock(head, children);
    blocks.push({ head, children, emergentMove, tone });
  };

  for (const s of sentences) {
    const comps = components(s.text);
    const startsPivot = comps.length > 0 && comps[0].fn === 'PIVOT-RESUME';
    const speakerChange = cur != null && s.speaker != null && cur.speaker != null && s.speaker !== cur.speaker;
    if (!cur || startsPivot || speakerChange) {
      finish();
      cur = { headRaw: null, childRaw: [], speaker: s.speaker };
    }
    const beats = splitBeats(comps);
    if (!cur.headRaw) cur.headRaw = beats;
    else for (const b of beats) cur.childRaw.push(b);
  }
  finish();
  return blocks;
}

/** Render blocks in the user's →/↳/↧ Moving-parts notation (debug/inspection). */
export function renderBlocks(blocks: Block[]): string {
  const lines: string[] = [];
  const chain = (b: Beat) => b.comps.map((c) => `${c.surface}〈${c.fn}〉`).join(' → ') || '(none)';
  blocks.forEach((blk, i) => {
    if (i > 0) lines.push('   ↧');
    lines.push(`■ BLOCK ⟦${blk.emergentMove} | ${blk.tone}⟧`);
    blk.head.forEach((b, j) => lines.push(`  ${j === 0 ? 'head' : '  →'} [${b.move}] ${chain(b)}`));
    blk.children.forEach((b) => lines.push(`    ↳ [${b.move}] ${chain(b)}`));
  });
  return lines.join('\n');
}
