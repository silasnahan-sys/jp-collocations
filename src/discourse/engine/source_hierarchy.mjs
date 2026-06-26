// _tmp_pipeline/source_hierarchy.mjs
// Phase 4C: 統一 source 階層
//
// voicing (S / S→H / S→X / S+H) と quote source (self / addressee /
// third / generic / hypothetical) と thoughtLayer を一つの階層に統合する。
//
// 7 系列:
//   'narrator'          地の声 (S, thought=null/exterior)
//   'narrator-musing'   地の声の内省 (S, thoughtLayer=interior.musing/verdict 等)
//   'narrator-to-self'  自己思考の引用 (と思う/と感じる 等で囲まれた声)
//   'addressee-evoked'  聴き手予期の召喚 (S→H, evoked-assumption)
//   'shared-space'      同席空間 (S+H, ね/さ/じゃないですか)
//   'third-party'       第三者の声 (S→X, attributed quote)
//   'generic-cited'     一般的事実引用 (suspended quote, ことわざ/通念)
//   'hypothetical'      仮想話者の声 (hypothetical quote / exemplar の中身)
//
// 各 hit には sourceTier が必ず立つ (null 不可)。
// 各 quoteFrame にも sourceTier が立つ。
//
// 階層化方針:
//   - quoteRelation='inside-quote' → quoteScope.source から決定
//   - quoteRelation='quote-host'/'exemplar-presenter' → 地の声側 (narrator)
//   - quoteRelation=null かつ thoughtLayer=interior.* → narrator-musing
//   - quoteRelation=null かつ voice='S→H' → addressee-evoked
//   - quoteRelation=null かつ voice='S+H' → shared-space
//   - quoteRelation=null かつ voice='S→X' → third-party
//   - 既定 → narrator

const TIER_LABEL_JA = {
  'narrator':          '地の声',
  'narrator-musing':   '地の声・内省',
  'narrator-to-self':  '自己思考引用',
  'addressee-evoked':  '聴き手予期召喚',
  'shared-space':      '同席空間',
  'third-party':       '第三者声',
  'generic-cited':     '一般通念引用',
  'hypothetical':      '仮想話者',
};

const TIER_ORDER = [
  'narrator',
  'narrator-musing',
  'shared-space',
  'addressee-evoked',
  'narrator-to-self',
  'third-party',
  'generic-cited',
  'hypothetical',
];

/**
 * quote source → tier
 */
function sourceToTier(qsource) {
  if (!qsource) return 'narrator';
  if (qsource === 'self') return 'narrator-to-self';
  if (qsource === 'addressee') return 'addressee-evoked';
  if (qsource === 'generic') return 'generic-cited';
  if (qsource === 'hypothetical' || qsource === 'unattributed') return 'hypothetical';
  if (qsource.startsWith('third:')) return 'third-party';
  return 'narrator';
}

/**
 * 1 hit に sourceTier を決定して付与する
 */
function tierForHit(h) {
  // 1) inside-quote の hit は引用本体の声
  if (h.quoteRelation === 'inside-quote' && h.quoteScope) {
    return sourceToTier(h.quoteScope.source);
  }
  // 2) host / exemplar-presenter は地の声側 (引用を *掲げる* 行為)
  if (h.quoteRelation === 'quote-host' || h.quoteRelation === 'exemplar-presenter') {
    return 'narrator';
  }
  // 3) thoughtLayer ベース
  const tl = h.thoughtLayer || '';
  if (tl.startsWith('interior.')) {
    // self-quote だけ別系
    if (tl === 'interior.self-quote') return 'narrator-to-self';
    return 'narrator-musing';
  }
  // 4) voicing ベース
  switch (h.voice) {
    case 'S→H': return 'addressee-evoked';
    case 'S+H': return 'shared-space';
    case 'S→X': return 'third-party';
    case 'S':
    default:    return 'narrator';
  }
}

/**
 * 全 hit + quoteFrame に sourceTier を付与し、文単位の source プロファイルを返す
 *
 * @param {Array} hits   compose 済 hit 配列
 * @param {Array} frames quoteFrames
 * @returns {{
 *   tiers: Array<string>,     // 出現順 tier
 *   tierCounts: Object,       // tier -> count
 *   activeTier: string,       // 最も支配的な tier
 *   tierTransitions: Array,   // tier 切替のシーケンス
 * }}
 */
export function assignSourceTiers(hits, frames) {
  const tierCounts = {};
  const seq = [];
  for (const h of (hits || [])) {
    const tier = tierForHit(h);
    h.sourceTier = tier;
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    if (seq.length === 0 || seq[seq.length - 1] !== tier) seq.push(tier);
  }
  for (const f of (frames || [])) {
    f.sourceTier = sourceToTier(f.source);
  }
  // 支配的 tier (narrator は分母に含めるが、他が一定数あれば他を優先)
  let activeTier = 'narrator';
  let best = 0;
  for (const k of Object.keys(tierCounts)) {
    if (k === 'narrator') continue;
    if (tierCounts[k] > best) { best = tierCounts[k]; activeTier = k; }
  }
  if (best === 0) activeTier = 'narrator';
  // tier transitions: seq の隣接ペア
  const tierTransitions = [];
  for (let i = 1; i < seq.length; i++) {
    tierTransitions.push({ from: seq[i - 1], to: seq[i] });
  }
  return {
    tiers: seq,
    tierCounts,
    activeTier,
    tierTransitions,
  };
}

export { TIER_LABEL_JA, TIER_ORDER };
