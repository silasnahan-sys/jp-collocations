/**
 * probe.ts — §29 rung 3: the descent ladder, and silence labelled by KIND.
 *
 * ## Why silence is the subject and not the failure
 *
 * MEASURED on the live corpus (2,480 tweets / 1,183,143 chars): 印象 appears in
 * 47 tweets, 印象として in ONE, 印象として持っている in none, and
 * 僕は印象として持っている in none and never will. At this size **silence is the
 * modal answer**. A view that responds to it with an empty list is not being
 * modest, it is throwing the finding away — because the interesting fact is not
 * that the corpus lacks your sentence, it is WHICH PIECE of your sentence it
 * lacks, and what it holds instead.
 *
 * ## The machine's first duty is to attack the query's own over-specification
 *
 * You arrive with a draft thought, not a string you have (§27's reach-for
 * inversion). Draft thoughts are over-specified: 僕は is an anchor that costs
 * everything, because zero anaphora makes the subjectless form dominant. So the
 * ladder does leave-one-out over the probe's own pieces, reports the count at
 * every rung, and NAMES what it dropped to get there.
 *
 * Pieces come from `tokenizeForCanvas` with the dictionary probe — the
 * segmenter the plugin already has and the only one it is ever going to have
 * (§29.4: typing is deinflect+lookup, no parser). Nothing new is invented here.
 *
 * ## Six verdicts, because "no results" is six different facts
 *
 *   顕在        attested and spread — the corpus can speak to this
 *   偏在        attested, but concentrated in one voice or one document
 *   競合        attested, and something else at the same rung is markedly more
 *               common (fires only when the caller supplies the rivals — the
 *               machine does not invent competitors it was never shown)
 *   沈黙・有意   silent HERE, attested SHORTER — the silence located the
 *               over-specification, which is the useful answer
 *   沈黙・無力   silent all the way down, but the pieces are real words — the
 *               corpus simply does not hold it
 *   圏外        silent all the way down and the pieces are not words the shelf
 *               knows — outside this corpus's domain (an invented label, say)
 *
 * ## Stop rules, so the descent is bounded and says why it stopped
 *
 *   床  the span got too short to mean anything (a knob)
 *   逸  the next drop would remove the CORE — you would be asking a different
 *       question, and a ladder that drifts off its own subject is noise
 *   平  the drop bought nothing: the count did not materially improve, so the
 *       rung above it is already the informative one
 *
 * The core is the token with the highest kanji density (ties → longer): a
 * pure-kanji token is content, kana-heavy tokens are grammar and inflection.
 * That is a heuristic and a knob, not a claim — rung 4 supersedes it for
 * constructions, where the fixed material can be the kana half.
 */

/** What the corpus holds for one span. Occurrences, documents, and voices. */
export interface CorpusCount {
  occ: number;
  docs: number;
  authors: number;
}

export type Counter = (span: string) => CorpusCount;

export interface Rung {
  span: string;
  count: CorpusCount;
  /** what was removed to reach this rung, and from which end. */
  dropped?: { text: string; side: 'left' | 'right' };
}

export type Verdict = '顕在' | '偏在' | '競合' | '沈黙・有意' | '沈黙・無力' | '圏外';
export type StopRule = '床' | '逸' | '平';

export interface ProbeResult {
  probe: string;
  /** rungs[0] is the probe as asked; each later rung names what it dropped. */
  rungs: Rung[];
  /**
   * The MOST SPECIFIC attested rung — the smallest edit to the question that
   * the corpus can answer. This is the actionable one: it names the minimal
   * over-specification rather than the most popular fragment.
   */
  nearest: Rung | null;
  /**
   * The best-attested rung, however far down. Where the distribution lives,
   * and what the environments are worth looking at (rung 2).
   */
  surviving: Rung | null;
  verdict: Verdict;
  /** the verdict's own stated reason — never a bare label. */
  why: string;
  stoppedBy: StopRule | null;
}

export interface DescendOpts {
  /** 床 — spans shorter than this are not worth asking about. */
  floorLen?: number;
  /** 平 — a drop must multiply the count by at least this to earn a rung. */
  plateau?: number;
  /** 顕在 needs at least this many occurrences (and more than one voice). */
  manifest?: number;
  /** used only to tell 圏外 (not even words) from 沈黙・無力 (real words, absent). */
  isWord?: (s: string) => boolean;
  /** rivals at the probe's own rung. 競合 cannot fire without them. */
  variants?: Array<{ span: string; count: CorpusCount }>;
}

const KANJI_RE = /[㐀-䶿一-鿿々]/;

/** Kanji density: content tokens are dense, grammar and inflection are not. */
function density(tok: string): number {
  if (!tok.length) return 0;
  let k = 0;
  for (const c of tok) if (KANJI_RE.test(c)) k++;
  return k / tok.length;
}

/**
 * The token the question is ABOUT. Highest kanji density wins; longer breaks
 * ties. Exported because the 逸 rule is only as honest as this choice, and a
 * caller that knows better (a 💠 frame's fixed material, say) should override.
 */
export function coreOf(pieces: string[]): string {
  let best = '';
  let bestD = -1;
  for (const p of pieces) {
    const d = density(p);
    if (d > bestD || (d === bestD && p.length > best.length)) { best = p; bestD = d; }
  }
  return best;
}

const EMPTY: CorpusCount = { occ: 0, docs: 0, authors: 0 };

/**
 * Walk the ladder. At each step both ends are tried and the better drop wins;
 * on a tie the LEFT goes, because a leading anchor is the usual
 * over-specification and dropping it is the move that most often pays.
 */
export function descend(
  probe: string,
  pieces: string[],
  count: Counter,
  opts: DescendOpts = {},
): ProbeResult {
  const floorLen = opts.floorLen ?? 2;
  const plateau = opts.plateau ?? 2;
  const manifest = opts.manifest ?? 3;
  const core = coreOf(pieces);

  const rungs: Rung[] = [{ span: probe, count: count(probe) }];
  let cur = [...pieces];
  let stoppedBy: StopRule | null = null;

  while (cur.length > 1) {
    const prev = rungs[rungs.length - 1];

    const leftPieces = cur.slice(1);
    const rightPieces = cur.slice(0, -1);
    const leftLegal = cur[0] !== core && leftPieces.join('').length >= floorLen;
    const rightLegal = cur[cur.length - 1] !== core && rightPieces.join('').length >= floorLen;

    if (!leftLegal && !rightLegal) {
      // Name which rule actually bit: losing the core, or hitting the floor.
      const coreAtAnEnd = cur[0] === core || cur[cur.length - 1] === core;
      stoppedBy = coreAtAnEnd ? '逸' : '床';
      break;
    }

    const leftSpan = leftPieces.join('');
    const rightSpan = rightPieces.join('');
    const cl = leftLegal ? count(leftSpan) : EMPTY;
    const cr = rightLegal ? count(rightSpan) : EMPTY;

    // tie → drop the LEFT anchor
    const takeLeft = leftLegal && (!rightLegal || cl.occ >= cr.occ);
    const span = takeLeft ? leftSpan : rightSpan;
    const c = takeLeft ? cl : cr;
    const dropped = takeLeft
      ? { text: cur[0], side: 'left' as const }
      : { text: cur[cur.length - 1], side: 'right' as const };

    // 平 — once something is attested, a drop that does not materially improve
    // it is not a new answer, it is the same answer with less of the question.
    if (prev.count.occ > 0 && c.occ < prev.count.occ * plateau) {
      stoppedBy = '平';
      break;
    }

    rungs.push({ span, count: c, dropped });
    cur = takeLeft ? leftPieces : rightPieces;
  }

  if (!stoppedBy && cur.length <= 1) stoppedBy = '床';

  const nearest = rungs.find((r) => r.count.occ > 0) ?? null;
  const surviving = [...rungs].reverse().find((r) => r.count.occ > 0) ?? null;
  const { verdict, why } = judge(rungs, nearest, surviving, pieces, { manifest, ...opts });

  return { probe, rungs, nearest, surviving, verdict, why, stoppedBy };
}

function judge(
  rungs: Rung[],
  nearest: Rung | null,
  surviving: Rung | null,
  pieces: string[],
  opts: DescendOpts & { manifest: number },
): { verdict: Verdict; why: string } {
  const full = rungs[0].count;

  if (full.occ > 0) {
    const rival = (opts.variants ?? [])
      .filter((v) => v.count.occ >= full.occ * 3)
      .sort((a, b) => b.count.occ - a.count.occ)[0];
    if (rival) {
      return {
        verdict: '競合',
        why: `${full.occ}件あるが、${rival.span} が ${rival.count.occ}件 — 同じ位置でより一般的`,
      };
    }
    if (full.authors <= 1 || full.docs <= 1) {
      return {
        verdict: '偏在',
        why: `${full.occ}件あるが ${full.authors}人・${full.docs}件に偏る — 一般性は未確認`,
      };
    }
    if (full.occ >= opts.manifest) {
      return { verdict: '顕在', why: `${full.occ}件・${full.authors}人に分布` };
    }
    return { verdict: '偏在', why: `${full.occ}件のみ（${full.authors}人）— 少数の実例` };
  }

  if (nearest) {
    // The finding is the SMALLEST edit that the corpus can answer — that is
    // where the over-specification actually is. The deeper, better-attested
    // rung is reported alongside it, never instead of it: 印象 at 70 is the
    // distribution, but 印象として at 1 is the answer to what was asked.
    const upTo = rungs.indexOf(nearest);
    const dropped = rungs
      .slice(1, upTo + 1)
      .map((r) => r.dropped?.text)
      .filter(Boolean)
      .join('・');
    const deeper = surviving && surviving !== nearest
      ? `／ ${surviving.span} なら ${surviving.count.occ}件`
      : '';
    return {
      verdict: '沈黙・有意',
      why: dropped
        ? `この形は0件。${dropped} を外すと ${nearest.span} が ${nearest.count.occ}件 — 過剰指定はそこ ${deeper}`.trim()
        : `この形は0件。${nearest.span} なら ${nearest.count.occ}件`,
    };
  }

  const known = opts.isWord ? pieces.some((p) => opts.isWord!(p)) : false;
  return known
    ? { verdict: '沈黙・無力', why: '語としては実在するが、このコーパスは一度も持っていない' }
    : { verdict: '圏外', why: '構成要素が辞書にもコーパスにもない — この語彙圏の外' };
}

/** The verdict as one line the view can print without composing anything. */
export function verdictLine(r: ProbeResult): string {
  return `${r.verdict} — ${r.why}`;
}
