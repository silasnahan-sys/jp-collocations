// _tmp_pipeline/transitions.mjs
// 隣接 2〜3 文の構造遷移を 3 値で判定する(narrate.mjs の入力)。
// 観測根拠は L1〜L5 のみ。文学的判断は持ち込まない。

/**
 * @typedef {'evoke-then-cancel'|'evoke-then-reframe'|'none'} TransitionKind
 * @typedef {{
 *   kind: TransitionKind,
 *   from: number,           // 起点 sentence idx
 *   to:   number,           // 終点 sentence idx
 *   evidence: string[],     // どのスパン/op/voice から判定したか
 * }} Transition
 */

/**
 * 単一文内の遷移を 1 件返す(該当なしは null)。
 *   evoke-then-cancel  ... 「もうやはり…(なん)ですけど」直後に否定/逆接
 *   evoke-then-reframe ... 「もうやはり…ですけど」直後に新しい召喚枠を立て直す
 */
export function detectInSentence(sentence) {
  const ops = (sentence.hits || []).map(h => h.opId);
  const hingeIdx = ops.findIndex(o => o === 'EXPLAIN-NOMINAL' || o === 'CONCESSIVE-CONTRAST');
  if (hingeIdx < 0) return null;
  const beforeHinge = ops.slice(0, hingeIdx);
  const afterHinge  = ops.slice(hingeIdx + 1);
  const hasEvoke = beforeHinge.includes('STANCE-PACKAGE') ||
                  (beforeHinge.includes('TEMPORAL-NOW') && beforeHinge.includes('EXPECTATION-CONFIRM'));
  if (!hasEvoke) return null;

  // hinge の右に新しい召喚 signature(もう/やはり/STANCE-PACKAGE)があるか
  const hasReframe = afterHinge.some(o =>
    o === 'STANCE-PACKAGE' || o === 'TEMPORAL-NOW' || o === 'EXPECTATION-CONFIRM'
  );
  if (hasReframe) {
    return {
      kind: 'evoke-then-reframe',
      from: sentence.idx, to: sentence.idx,
      evidence: [`hinge:${ops[hingeIdx]}`, 'right-side has another evoke signature'],
    };
  }
  return {
    kind: 'evoke-then-cancel',
    from: sentence.idx, to: sentence.idx,
    evidence: [`hinge:${ops[hingeIdx]}`, 'no reframe on right side'],
  };
}

/**
 * 文書全体を走査して transitions を集める。隣接 2 文の跨ぎ判定は将来 P1.2 で
 * cross-turn 解決と統合する(現状は単一文 only)。
 * @param {Array<any>} sentences
 * @returns {Transition[]}
 */
export function detectAll(sentences) {
  const out = [];
  for (const s of sentences) {
    const t = detectInSentence(s);
    if (t) out.push(t);
  }
  return out;
}
