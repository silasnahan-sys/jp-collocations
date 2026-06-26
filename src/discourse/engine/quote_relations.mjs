// _tmp_pipeline/quote_relations.mjs
// L3.5 引用関係層:
//
// 「op が何であるか」だけではなく「op が引用構造の中でどう機能しているか」を
// 全ての hit に貫通させる。
//
// 各 hit に以下を付与する:
//
//   hit.quoteRelation:
//     null                  地の文に立つ op(引用と無関係)
//     'inside-quote'        引用された命題の内部に立つ op
//     'quote-host'          op 自体が引用マーカー (と/って/という/と思う 等)
//     'exemplar-presenter'  引用を「事例/type の例示」として掲げる行為
//                           (COUNTERFACTUAL-IDENTIFY / EXAM-FRAME-MARK 等)
//
//   hit.quoteScope:
//     null                  上記が null のとき
//     {
//       quoteId,            自分が紐付く引用 (quotes 配列のインデックス参照名)
//       quoteType,           quote.attributed / evoked-assumption / suspended /
//                            self-thought / hypothetical
//       source,              発話/思考の源泉 'self' | 'addressee' | 'third:<name>'
//                                          | 'generic' | 'hypothetical'
//       addressee,           'addressee' | 'self' | 'audience' | null
//       rhetoricalUse,       'cite-as-fact' | 'cite-as-exemplar' |
//                            'cite-as-hypothetical' | 'cite-as-evoked-then-pivot' |
//                            'cite-as-self-musing'
//       citedSurface,        引用された命題の表面文字列(close marker は含まない)
//       role,                'inside' | 'frame' | 'exemplar'
//     }
//
// 「引用」という構造は voicing/source の特殊化であり、ここではまず A 段階
// (全 op に引用との関係を貫通) を実装する。

/** 引用マーカー側になり得る op id */
const QUOTE_HOST_OPS = new Set([
  'QUOTATIVE-ATTRIB',
  'QUOTATIVE-SPEECH',
  'EPISTEMIC-THINK',
  'EVIDENTIAL-HEARSAY',
  'UNDERSTANDING-REPORT',
  'UNDERSTANDING-CHECK',
  'GENRE-CITATION',
  'APPROXIMATIVE-QUOTE',
]);

/**
 * exemplar として引用を掲げる op 群。
 * 引用された命題そのものより「この命題を type の例として持ち出す行為」が
 * 主要 op であるという階層を反映する。
 */
const EXEMPLAR_PRESENTER_OPS = new Set([
  'COUNTERFACTUAL-IDENTIFY',
  'EXAM-FRAME-MARK',
  'HYPOTHETICAL-FRAME',
  'CONVICTION-CONDITIONAL',
  'GENRE-CITATION',
  'DEEPEN-PROBE-OPEN',
  'STRATEGIC-CALCULUS',
]);

/** 第三者名詞検出(暫定) */
const THIRD_PERSON_RE = /(?:お父さん|お母さん|父|母|先生|社長|友達|彼|彼女|[一-龥ァ-ヶー]{2,}さん|[一-龥ァ-ヶー]+(?:氏|君|くん|ちゃん))/;

/** 一人称マーカー */
const FIRST_PERSON_RE = /(?:私|僕|俺|うち|あたし|自分)/;

/**
 * 各 quote について、引用された命題の表面範囲を推定する。
 * quote.offset は「と / って / という」の開始位置。
 * 引用範囲は (直前の閉じマーカー or 直前の引用 close or 文頭) から quote.offset まで。
 *
 * @returns {Array<{quoteId:string, span:[number,number], cited:string, marker:any}>}
 */
function computeQuoteSpans(text, quotes) {
  const sorted = [...quotes].sort((a, b) => a.offset - b.offset);
  const spans = [];
  let prevEnd = 0;
  for (let i = 0; i < sorted.length; i++) {
    const q = sorted[i];
    // 直前の引用 close より後 ~ q.offset 直前 までを引用本体とみなす
    let start = prevEnd;
    // 「、。」「は」「が」など主節境界がある場合は最後の境界以降に縮める
    const segment = text.slice(start, q.offset);
    const boundaryRe = /[、。．！？!?]/g;
    let bm, lastBoundary = -1;
    while ((bm = boundaryRe.exec(segment)) !== null) lastBoundary = bm.index;
    if (lastBoundary >= 0) start = start + lastBoundary + 1;
    // 開きカギ括弧があれば優先
    const openQuoteIdx = text.lastIndexOf('「', q.offset - 1);
    if (openQuoteIdx >= start && openQuoteIdx < q.offset) start = openQuoteIdx + 1;
    const closeQuoteIdx = text.lastIndexOf('」', q.offset);
    // 「閉じ括弧」が直前にあれば、それ以降を引用とみなす
    if (closeQuoteIdx >= start && closeQuoteIdx < q.offset) start = closeQuoteIdx + 1;
    const cited = text.slice(start, q.offset);
    spans.push({
      quoteId: `q${i}`,
      span: [start, q.offset],
      cited,
      marker: q,
    });
    prevEnd = q.offset + q.length;
  }
  return spans;
}

/**
 * quote.type → rhetoricalUse の対応
 */
function inferRhetoricalUse(quoteType, hostOpId, citedText) {
  if (quoteType === 'quote.self-thought') return 'cite-as-self-musing';
  if (quoteType === 'quote.evoked-assumption') return 'cite-as-evoked-then-pivot';
  if (quoteType === 'quote.suspended') return 'cite-as-fact';
  if (quoteType === 'quote.attributed') {
    if (hostOpId && EXEMPLAR_PRESENTER_OPS.has(hostOpId)) return 'cite-as-exemplar';
    return 'cite-as-fact';
  }
  return 'cite-as-fact';
}

/**
 * source 推定 (暫定):
 *   - 引用本体に一人称 → 'self'
 *   - 引用本体に第三者名詞 → 'third:<name>'
 *   - quote.evoked-assumption → 'addressee'
 *   - quote.self-thought → 'self'
 *   - quote.suspended → 'generic'
 *   - hypothetical → 'hypothetical'
 *   - 既定 → 'unattributed'
 */
function inferSource(quoteType, citedText, textCtx) {
  if (quoteType === 'quote.self-thought') return 'self';
  if (quoteType === 'quote.evoked-assumption') return 'addressee';
  const ctxBefore = textCtx || '';
  const thirdMatch = (citedText + ' ' + ctxBefore).match(THIRD_PERSON_RE);
  if (thirdMatch) return `third:${thirdMatch[0]}`;
  if (FIRST_PERSON_RE.test(citedText)) return 'self';
  if (quoteType === 'quote.suspended') return 'generic';
  return 'unattributed';
}

function inferAddressee(quoteType, source) {
  if (quoteType === 'quote.evoked-assumption') return 'addressee';
  if (quoteType === 'quote.self-thought') return 'self';
  return 'audience';
}

/**
 * メイン:全 hit に quoteRelation/quoteScope を付与し、
 * 戻り値として「文単位の引用関係サマリ」を返す。
 *
 * @param {string} text
 * @param {Array<any>} hits  voicing 済 hits
 * @param {Array<any>} quotes  classifyQuotes の出力
 * @returns {{spans: Array, frames: Array}}
 */
export function assignQuoteRelations(text, hits, quotes) {
  // 1) 引用本体スパンを推定
  const spans = computeQuoteSpans(text, quotes);

  // 2) host op を解決:各 quote の直近(±3 字)の hit を host とみなす
  const hostByQuoteId = new Map();
  for (const sp of spans) {
    const q = sp.marker;
    let best = null, bestDist = Infinity;
    for (const h of hits) {
      if (!QUOTE_HOST_OPS.has(h.opId) &&
          !EXEMPLAR_PRESENTER_OPS.has(h.opId)) continue;
      // host は quote マーカーを覆うか直近にある hit
      const hStart = h.offset;
      const hEnd = h.offset + (h.length || 0);
      const overlap = hStart <= q.offset && q.offset < hEnd;
      const dist = overlap ? 0 : Math.min(
        Math.abs(hStart - (q.offset + q.length)),
        Math.abs(hEnd - q.offset)
      );
      if (dist < bestDist) { bestDist = dist; best = h; }
    }
    if (best && bestDist <= 5) hostByQuoteId.set(sp.quoteId, best);
  }

  // 3) 各 hit に quoteRelation/quoteScope を付与
  const frames = [];
  for (const h of hits) {
    h.quoteRelation = null;
    h.quoteScope = null;
  }
  for (const sp of spans) {
    const q = sp.marker;
    const host = hostByQuoteId.get(sp.quoteId) || null;
    const ctxBefore = text.slice(Math.max(0, sp.span[0] - 30), sp.span[0]);
    const rhetoricalUse = inferRhetoricalUse(
      q.type,
      host ? host.opId : null,
      sp.cited
    );
    const source = inferSource(q.type, sp.cited, ctxBefore);
    const addressee = inferAddressee(q.type, source);

    const frame = {
      quoteId: sp.quoteId,
      quoteType: q.type,
      markerOffset: q.offset,
      markerSurface: q.surface,
      citedSurface: sp.cited,
      citedSpan: sp.span,
      hostOpId: host ? host.opId : null,
      source,
      addressee,
      rhetoricalUse,
      isExemplar: host ? EXEMPLAR_PRESENTER_OPS.has(host.opId) : false,
    };
    frames.push(frame);

    // 3a) inside-quote: 引用本体スパンに入る hit
    for (const h of hits) {
      if (h.offset >= sp.span[0] && (h.offset + (h.length || 0)) <= sp.span[1] + q.length) {
        // host hit 自体は inside にしない
        if (h === host) continue;
        // 既に inside-quote 判定済みで、より内側があれば上書き(最深)
        if (h.quoteRelation === 'inside-quote' && h.quoteScope) {
          const cur = h.quoteScope.citedSpan;
          if (cur[1] - cur[0] <= sp.span[1] - sp.span[0]) continue;
        }
        h.quoteRelation = 'inside-quote';
        h.quoteScope = {
          quoteId: sp.quoteId,
          quoteType: q.type,
          source,
          addressee,
          rhetoricalUse,
          citedSurface: sp.cited,
          citedSpan: sp.span,
          role: 'inside',
        };
      }
    }

    // 3b) host hit に quote-host / exemplar-presenter を付与
    if (host) {
      const role = EXEMPLAR_PRESENTER_OPS.has(host.opId) ? 'exemplar' : 'frame';
      host.quoteRelation = EXEMPLAR_PRESENTER_OPS.has(host.opId)
        ? 'exemplar-presenter'
        : 'quote-host';
      host.quoteScope = {
        quoteId: sp.quoteId,
        quoteType: q.type,
        source,
        addressee,
        rhetoricalUse,
        citedSurface: sp.cited,
        citedSpan: sp.span,
        role,
      };
    }
  }

  // 4) exemplar-presenter op がいるが host 解決に漏れた場合の補完
  //    classifyQuotes は「って+認識動詞」(「って分かった」等) を捨てるので、
  //    exemplar-presenter op の surface に引用マーカーを含む場合は
  //    合成 quoteFrame を立てる。
  for (const h of hits) {
    if (h.quoteRelation) continue;
    if (!EXEMPLAR_PRESENTER_OPS.has(h.opId)) continue;
    // この hit の表面領域に最も近い quote を割り当てる
    let best = null, bestDist = Infinity;
    for (const sp of spans) {
      const dist = Math.abs(sp.marker.offset - h.offset);
      if (dist < bestDist) { bestDist = dist; best = sp; }
    }
    if (best && bestDist <= (h.length || 0) + 5) {
      h.quoteRelation = 'exemplar-presenter';
      h.quoteScope = {
        quoteId: best.quoteId,
        quoteType: best.marker.type,
        source: inferSource(best.marker.type, best.cited, ''),
        addressee: inferAddressee(best.marker.type, null),
        rhetoricalUse: inferRhetoricalUse(best.marker.type, h.opId, best.cited),
        citedSurface: best.cited,
        citedSpan: best.span,
        role: 'exemplar',
      };
      continue;
    }
    // フォールバック: surface に って/と/という を含むなら合成 frame を立てる
    const surface = h.surface || '';
    const mk = surface.match(/っていう|という|って|と/);
    if (!mk) continue;
    const mkOffset = h.offset + mk.index;
    const cited = surface.slice(0, mk.index) ||
      text.slice(Math.max(0, h.offset - 15), h.offset);
    const synthType = 'quote.hypothetical';
    const synthSource = inferSource(synthType, cited, '') || 'hypothetical';
    const synthFrame = {
      quoteId: `q${spans.length + frames.length}`,
      quoteType: synthType,
      markerOffset: mkOffset,
      markerSurface: mk[0],
      citedSurface: cited,
      citedSpan: [Math.max(0, mkOffset - cited.length), mkOffset],
      hostOpId: h.opId,
      source: synthSource,
      addressee: 'audience',
      rhetoricalUse: 'cite-as-exemplar',
      isExemplar: true,
      synthetic: true,
    };
    frames.push(synthFrame);
    h.quoteRelation = 'exemplar-presenter';
    h.quoteScope = {
      quoteId: synthFrame.quoteId,
      quoteType: synthType,
      source: synthSource,
      addressee: 'audience',
      rhetoricalUse: 'cite-as-exemplar',
      citedSurface: cited,
      citedSpan: synthFrame.citedSpan,
      role: 'exemplar',
    };
  }

  return { spans, frames };
}

// テスト用のヘルパ export
export const _internal = {
  QUOTE_HOST_OPS,
  EXEMPLAR_PRESENTER_OPS,
  computeQuoteSpans,
  inferRhetoricalUse,
  inferSource,
};
