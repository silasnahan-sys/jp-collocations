// _tmp_pipeline/thought.mjs
// =====================================================================
// 内側 / 外側 思考層 (THOUGHT LAYER) 付与モジュール
// ---------------------------------------------------------------------
// 既存の voice 軸 (S / S→H / S→X / S+H) は「誰の声か」を示すが、
// 「その発話が話者内部の作業か、対人面の所作か」は別軸として扱う必要が
// ある。倫理談話/教師-生徒談話などでは、内省独白と応答取りが入り混じり
// 両者を分離しないと quote 分類や flow-state が破綻する。
//
// 軸定義:
//   interior.musing      — 内面の試験的印象  (〜気がして, 〜のかな)
//   interior.verdict     — 内面で下した評定  (足りうる, 〜と思います)
//   interior.world-build — 仮想世界の構築中  (もし, 例えば〜として)
//   interior.self-quote  — 自分自身の発話/想念を引用
//   interior.reasoning   — 連鎖推論を顕在化  (から, ので, で…)
//
//   exterior.address     — 聞き手向け宣言    (default)
//   exterior.backchannel — 応答取り          (うん, はい, あ、そうなんだ)
//   exterior.meta        — 会話自体への論評  (危ねえ, 言われちゃったら)
//   exterior.frame-mark  — 談話枠標          (テストだ, 話を変えると)
//
// 付与手順:
//   1) 各 hit のデフォルト層を lexicon の op.thoughtLayer から取得
//   2) スパン文脈で上書き (conditional/hypothetical 内なら world-build へ)
//   3) quote 文脈で上書き (自己引用なら self-quote へ)
//   4) 既定が無い op は voice から推定 (S→H で末尾位置なら backchannel)
// =====================================================================

import { OP_BY_ID } from './lexicon.mjs';

const BACKCHANNEL_OPS = new Set([
  'AGREE-MARK', 'STRONG-AGREEMENT', 'CONFIRMATION-SEEK',
]);

const REASONING_OPS = new Set([
  'CAUSAL-DERIVE', 'CAUSAL-DEPENDENT', 'CAUSAL-DISCOURSE',
  'EXPLAIN-NOMINAL',
]);

const WORLD_BUILD_OPS = new Set([
  'CONDITIONAL-ANTECEDENT', 'HYPOTHETICAL-SUPPOSING',
  'COUNTERFACTUAL-IDENTIFY', 'CONVICTION-CONDITIONAL',
  'EXEMPLIFY',
]);

const VERDICT_OPS = new Set([
  'EPISTEMIC-THINK', 'EPISTEMIC-EXPECT', 'EPISTEMIC-MAY',
  'POTENTIAL-PERMISSION', 'EVIDENTIAL-SEEM',
]);

const FRAME_MARK_OPS = new Set([
  'EXAM-FRAME-MARK', 'TOPIC-PIVOT-MARK', 'DEEPEN-PROBE-OPEN',
  'FRAME-PIVOT', 'NARRATIVE-LAUNCH',
]);

const META_OPS = new Set([
  'RELIEF-EXCLAIM', 'META-CONVERSATIONAL-EFFECT', 'GENRE-CITATION',
]);

/**
 * 単独 hit のデフォルト思考層を推定。
 * lexicon.thoughtLayer が定義済みならそれを採用、無ければ既知集合から逆引き。
 * 戻り値は {layer, source} で、source は信頼度の出所を表す:
 *   'lexicon'  — lexicon に thoughtLayer が明示されている
 *   'inferred' — 既知 OP 集合からの逆引き
 *   'fallback' — どの根拠にも当たらず exterior.address に落ちた = 未知バケット
 */
function defaultThoughtLayer(hit) {
  const op = OP_BY_ID.get(hit.opId);
  if (op && op.thoughtLayer) return { layer: op.thoughtLayer, source: 'lexicon' };
  if (BACKCHANNEL_OPS.has(hit.opId)) return { layer: 'exterior.backchannel', source: 'inferred' };
  if (REASONING_OPS.has(hit.opId))   return { layer: 'interior.reasoning', source: 'inferred' };
  if (WORLD_BUILD_OPS.has(hit.opId)) return { layer: 'interior.world-build', source: 'inferred' };
  if (VERDICT_OPS.has(hit.opId))     return { layer: 'interior.verdict', source: 'inferred' };
  if (FRAME_MARK_OPS.has(hit.opId))  return { layer: 'exterior.frame-mark', source: 'inferred' };
  if (META_OPS.has(hit.opId))        return { layer: 'exterior.meta', source: 'inferred' };
  return { layer: 'exterior.address', source: 'fallback' };
}

/**
 * spans の中で「hit が含まれる最強の枠」を判定。
 * conditional / hypothetical 系のスパン内なら world-build に押し下げる。
 */
function spanOverride(hit, spans) {
  if (!spans) return null;
  for (const sp of spans) {
    if (hit.offset < sp.start || hit.offset >= sp.end) continue;
    if (sp.label === 'conditional' || sp.label === 'hypothetical') {
      return 'interior.world-build';
    }
  }
  return null;
}

/**
 * quote 文脈での上書き。
 * voice が 'S' で quotes に self-thought がある領域に hit があれば self-quote。
 */
function quoteOverride(hit, quotes) {
  if (!quotes) return null;
  for (const q of quotes) {
    const inside = hit.offset >= Math.max(0, q.offset - 30) && hit.offset <= q.offset + q.length;
    if (!inside) continue;
    if (q.type === 'quote.self-thought' && hit.voice === 'S') {
      return 'interior.self-quote';
    }
    if (q.type === 'quote.attributed' && hit.voice && hit.voice.startsWith('S→')) {
      // 他者声に乗っているなら interior ではなく address (他者代弁)
      return 'exterior.address';
    }
  }
  return null;
}

/**
 * 文単位で hit 群に thoughtLayer を付与。in-place で hit を更新する。
 * @param {string} text
 * @param {Array<any>} hits  voicing 済み hits
 * @param {Array<any>} spans structure.spans
 * @param {Array<any>} quotes  classifyQuotes の結果
 */
export function assignThoughtLayer(text, hits, spans, quotes) {
  for (const h of hits) {
    const def = defaultThoughtLayer(h);
    let layer = def.layer;
    let source = def.source;
    // quote override first, then span override — conditional/hypothetical
    // 枠は引用層よりも優先される(仮想世界構築が引用かどうかに優越する)。
    const qo = quoteOverride(h, quotes);
    if (qo) { layer = qo; source = 'quote'; }
    const sp = spanOverride(h, spans);
    if (sp) { layer = sp; source = 'span'; }
    h.thoughtLayer = layer;
    // 信頼度の出所を明示。'fallback' = 根拠なしに exterior.address へ落ちた未知。
    h.thoughtLayerConfidence = source;
  }
  return hits;
}

/**
 * 文単位の集計: interior / exterior のバランスを返す。
 * 倫理談話では interior 偏重、対話交代では exterior 偏重になる。
 * unknown = 根拠なく既定値に落ちた hit 数(可視化のための「分からない」シグナル)。
 */
export function thoughtLayerProfile(hits) {
  const counts = { interior: 0, exterior: 0, total: 0 };
  const byLayer = new Map();
  let unknown = 0;
  for (const h of hits) {
    const l = h.thoughtLayer || 'exterior.address';
    counts.total++;
    if (l.startsWith('interior.')) counts.interior++;
    else counts.exterior++;
    byLayer.set(l, (byLayer.get(l) ?? 0) + 1);
    if (h.thoughtLayerConfidence === 'fallback') unknown++;
  }
  const interiorRatio = counts.total ? counts.interior / counts.total : 0;
  const unknownRatio = counts.total ? unknown / counts.total : 0;
  return {
    interior: counts.interior,
    exterior: counts.exterior,
    total: counts.total,
    interiorRatio,
    unknown,
    unknownRatio,
    byLayer: Object.fromEntries(byLayer),
  };
}
