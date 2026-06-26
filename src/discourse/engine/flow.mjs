// _tmp_pipeline/flow.mjs
// L4 speech-act パート分解 + L5 FLOW_STATE + L6 跨思考参照エッジ。
//
// 各文に対して:
//   - parts:      文内パート区間(launch/setup/evocation/pivot/claim/suspended)
//   - flowDelta:  この文が FLOW_STATE にもたらす差分
//   - crossRefs:  この文の各パートが過去のどのパートに反応しているか
//
// FLOW_STATE は turn ループで持ち回し、各文解析後に apply される。

/** 文末付近に評語動詞があるか */
function hasTailReportingVerb(text) {
  const tail = text.replace(/[。．！？!?\s]+$/, '').slice(-15);
  // 末尾近傍に評語動詞が出れば true(文末がモーダル「よね」「かな」等で終わっても拾う)
  return /(?:言|思|考|話|述|語|答|問|尋|聞|書|記|示|伝|呼ば)(?:わ|い|っ|う|え|る|て|た|まし|ました)/.test(tail);
}

/* ---------------------------------------------------------------- *
 * L4: speech-act パート分解
 * ---------------------------------------------------------------- */

/**
 * 文を内部パートに分解する。既存の spans / pivots / moves から導出。
 * @param {string} text
 * @param {object} structure  { spans, pivots, moves } 構造アーティファクト
 * @param {Array<any>} hits   voicing 済み hits
 * @param {Array<any>} quotes classifyQuotes の結果
 * @returns {Array<{label:string, start:number, end:number, voice:string|null, content:string}>}
 */
export function decomposeParts(text, structure, hits, quotes) {
  const parts = [];
  const end = text.length;
  const pushed = new Set();
  const add = (label, start, stop, voice = null, extra = {}) => {
    if (stop <= start) return;
    const key = `${label}:${start}:${stop}`;
    if (pushed.has(key)) return;
    pushed.add(key);
    parts.push({
      label, start, end: stop, voice,
      content: text.slice(start, stop),
      ...extra,
    });
  };

  // (1) launch — 文頭の NARRATIVE-LAUNCH move か接続辞
  const launch = (structure.moves || []).find(m => m.name === 'NARRATIVE-LAUNCH');
  if (launch) add('launch', launch.start, launch.end, 'S');

  // (2) suspended — 文末の SUSPENDED-NARRATIVE move か末尾と。
  const susp = (structure.moves || []).find(m => m.name === 'SUSPENDED-NARRATIVE');
  if (susp) add('suspended', susp.start, susp.end, null, { isSuspension: true });

  // (3) pivot — pivots の anchor
  for (const p of structure.pivots || []) {
    add('pivot', p.anchor.offset, p.anchor.offset + p.anchor.length, 'S', { hingeOp: p.opId });
  }

  // (4) evocation — S→H 声の hit が連続する領域
  const evokedHits = hits.filter(h => h.voice === 'S→H').sort((a, b) => a.offset - b.offset);
  if (evokedHits.length) {
    let i = 0;
    while (i < evokedHits.length) {
      let j = i;
      while (j + 1 < evokedHits.length &&
             evokedHits[j + 1].offset - (evokedHits[j].offset + evokedHits[j].length) <= 6) j++;
      const start = evokedHits[i].offset;
      const stop  = evokedHits[j].offset + evokedHits[j].length;
      add('evocation', start, stop, 'S→H', { members: evokedHits.slice(i, j + 1).map(h => h.opId) });
      i = j + 1;
    }
  }

  // (5) attributed-quote — 各引用類型を quoted-content として記録
  for (const q of quotes || []) {
    if (q.type === 'quote.attributed' || q.type === 'quote.self-thought') {
      // 引用内容の起点を粗推定:直前の句読点か文頭から
      const before = text.slice(0, q.offset);
      const commaIdx = Math.max(before.lastIndexOf('、'), before.lastIndexOf('，'),
                                 before.lastIndexOf('。'), before.lastIndexOf('!'),
                                 before.lastIndexOf('?'));
      const start = commaIdx >= 0 ? commaIdx + 1 : 0;
      add('quoted-content', start, q.offset, null, { quoteType: q.type });
    }
  }

  // (6) setup — 文頭〜最初の pivot / 最初の evocation / 最初の suspended まで
  const firstAnchor = parts
    .filter(p => p.label === 'pivot' || p.label === 'evocation' || p.label === 'suspended')
    .reduce((a, p) => Math.min(a, p.start), end);
  const setupStart = launch ? launch.end : 0;
  if (firstAnchor > setupStart) add('setup', setupStart, firstAnchor, 'S');

  // (7) claim — 最後の pivot 以降〜 suspended の前まで
  const lastPivot = (structure.pivots || []).slice(-1)[0];
  if (lastPivot) {
    const claimStart = lastPivot.anchor.offset + lastPivot.anchor.length;
    const claimEnd = susp ? susp.start : end;
    if (claimEnd > claimStart) add('claim', claimStart, claimEnd, 'S');
  }

  parts.sort((a, b) => a.start - b.start);
  // パート ID は呼び出し側で sentenceId を結合して付ける
  parts.forEach((p, k) => { p.id = `p${k}`; });
  return parts;
}

/* ---------------------------------------------------------------- *
 * L5: FLOW_STATE
 * ---------------------------------------------------------------- */

export function makeFlowState() {
  return {
    unclosedFrames:        [],   // {sentenceId, label, opensAt}
    suspendedPropositions: [],   // {sentenceId, partId, content, voicing, age}
    evokedAssumptions:     [],   // {sentenceId, partId, content, status, age}
    forwardCommitments:    [],   // {sentenceId, count, head, filled, slots:[], age} 列挙の前方コミット
    activeVoice:           'S',  // 現在優勢な視点
    topicStack:            [],   // {topic, sentenceId, depth}
    history:               [],   // {sentenceId, parts:[...], quotes:[...]}
  };
}

/**
 * 一文の解析結果を FLOW_STATE に適用し、差分を返す。
 * @param {object} flow
 * @param {{sentenceId:string|number, parts:any[], quotes:any[], hits:any[], structure:object, text:string}} sa
 */
export function applyFlow(flow, sa) {
  const delta = { added: [], closed: [], shifted: false };

  // 既存項目を加齢(age++)
  for (const arr of [flow.suspendedPropositions, flow.evokedAssumptions, flow.forwardCommitments]) {
    for (const item of arr) item.age = (item.age ?? 0) + 1;
  }

  // unclosed frames の追加
  for (const sp of sa.structure?.spans || []) {
    if (!sp.complete) {
      const item = {
        sentenceId: sa.sentenceId,
        label: sp.label,
        opensAt: sp.start,
        openOp: sp.openHit?.opId,
      };
      flow.unclosedFrames.push(item);
      delta.added.push({ kind: 'unclosed-frame', item });
    }
  }

  // suspended の追加
  for (const p of sa.parts) {
    if (p.label === 'suspended' || p.isSuspension) {
      const item = {
        sentenceId: sa.sentenceId,
        partId: p.id,
        content: p.content,
        voicing: p.voice,
        age: 0,
      };
      flow.suspendedPropositions.push(item);
      delta.added.push({ kind: 'suspended', item });
    }
  }

  // evoked assumptions の追加
  for (const p of sa.parts) {
    if (p.label === 'evocation') {
      const item = {
        sentenceId: sa.sentenceId,
        partId: p.id,
        content: p.content,
        status: 'pending',
        age: 0,
      };
      flow.evokedAssumptions.push(item);
      delta.added.push({ kind: 'evoked', item });
    }
  }

  // pivot があれば直近の pending evoked を 'discarded' に更新
  const hasPivot = sa.parts.some(p => p.label === 'pivot');
  if (hasPivot) {
    for (const e of flow.evokedAssumptions) {
      if (e.status === 'pending' && e.sentenceId === sa.sentenceId) {
        e.status = 'discarded-by-pivot';
        delta.shifted = true;
      }
    }
  }

  // 引用閉じ動詞が出れば、直近の suspended のうち voicing 一致のものを解決
  const hasCloser = (sa.quotes || []).some(q => q.type === 'quote.attributed') ||
                    hasTailReportingVerb(sa.text || '');
  if (hasCloser) {
    for (const s of flow.suspendedPropositions) {
      if (!s.resolvedBy && s.age > 0) {
        s.resolvedBy = sa.sentenceId;
        delta.closed.push({ kind: 'suspended-resolved', item: s });
      }
    }
  }

  // 列挙の前方コミット: enum.commit-open でコミットを積み、enum.ordinal で slot を埋める。
  // これが北極星「予告→回収」の機構的足場 (操作層では文内, ここで跨文に連結)。
  const opInst = sa.operations?.instances || [];
  // 同一文の複数序数辞(例:「まず一つ目」= まず + 一つ目)は同じ 1 スロットを指す。
  // よって 1 文につき discharge は最大 1。二重カウントするとコミットが早く満杯になり
  // 末尾の序数(三つ目)が回収先を失う(過去デモで露呈したバグ)。
  const ordinalInsts = opInst.filter(i => i.opId === 'enum.ordinal');
  if (ordinalInsts.length) {
    // この文の ordinal は「直近の未充足コミット」を 1 つ discharge する
    const open = [...flow.forwardCommitments].reverse()
      .find(c => c.sentenceId !== sa.sentenceId && c.filled < (c.count ?? Infinity));
    if (open) {
      open.filled += 1;
      open.slots.push({ sentenceId: sa.sentenceId, ordinal: ordinalInsts[0].ordinal });
      delta.closed.push({ kind: 'commitment-slot-filled', item: open });
    }
  }
  for (const inst of opInst) {
    if (inst.opId === 'enum.commit-open') {
      const item = {
        sentenceId: sa.sentenceId,
        count: inst.committedCount ?? null,
        head: inst.committedHead ?? null,
        filled: 0,
        slots: [],
        age: 0,
      };
      flow.forwardCommitments.push(item);
      delta.added.push({ kind: 'forward-commitment', item });
    }
  }

  // 視点更新:この文で支配的な voice を activeVoice に
  const voiceCount = new Map();
  for (const h of sa.hits || []) {
    voiceCount.set(h.voice, (voiceCount.get(h.voice) ?? 0) + 1);
  }
  if (voiceCount.size) {
    const top = [...voiceCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (top !== flow.activeVoice) {
      delta.shifted = true;
      flow.activeVoice = top;
    }
  }

  // 古い evoked / suspended / commitment の窓拭き(age > 20 で破棄。充足済みコミットも回収)
  flow.evokedAssumptions     = flow.evokedAssumptions    .filter(x => x.age <= 20);
  flow.suspendedPropositions = flow.suspendedPropositions.filter(x => x.age <= 20 && !x.resolvedBy);
  flow.forwardCommitments    = flow.forwardCommitments   .filter(x => x.age <= 20 && (x.count == null || x.filled < x.count));

  // 履歴に積む
  flow.history.push({
    sentenceId: sa.sentenceId,
    parts: sa.parts.map(p => ({ id: p.id, label: p.label, voice: p.voice, content: p.content })),
    quotes: (sa.quotes || []).map(q => ({ type: q.type, surface: q.surface })),
  });

  return delta;
}

/* ---------------------------------------------------------------- *
 * L6: 跨思考参照エッジ
 * ---------------------------------------------------------------- */

/**
 * 現在の文の各パートが、過去のどのパートに反応しているかを推定する。
 * @param {object} flow                        現時点の FLOW_STATE
 * @param {{sentenceId:string|number, parts:any[], quotes:any[]}} sa  現在の文
 * @returns {Array<{from:string, to:string, kind:string, score:number, evidence:string[]}>}
 */
export function detectCrossRefs(flow, sa) {
  const edges = [];
  const fullId = (sid, pid) => `${sid}.${pid}`;
  const idf = flow.idf; // P1.3: analyze.mjs から注入される(無くてもフォールバック動作)

  // (a) suspended 回収:現文に評語動詞 attributed があれば、過去の未解決 suspended を解決
  const closerQuote = (sa.quotes || []).find(q => q.type === 'quote.attributed');
  const tailReport = !closerQuote && hasTailReportingVerb(sa.text || '');
  if (closerQuote || tailReport) {
    for (const s of flow.suspendedPropositions) {
      if (s.resolvedBy) continue;
      if (s.sentenceId === sa.sentenceId) continue;
      edges.push({
        from: fullId(sa.sentenceId, sa.parts[0]?.id ?? 'p0'),
        to: fullId(s.sentenceId, s.partId),
        kind: 'resolves',
        score: closerQuote ? 0.9 : 0.7,
        evidence: [closerQuote ? 'attributed-closer-after-suspension' : 'tail-reporting-verb-after-suspension'],
      });
    }
  }

  // (b) evoked 追認/否定:現文に同じ語彙の主張があり、pivot の有無で判定
  for (const e of flow.evokedAssumptions) {
    if (e.status === 'pending' || e.status === 'discarded-by-pivot') continue;
    if (e.sentenceId === sa.sentenceId) continue;
    const kw = keywordsByIdf(e.content, idf);
    const hit = sa.parts.find(p =>
      (p.label === 'claim' || p.label === 'setup') &&
      kw.some(k => p.content.includes(k))
    );
    if (hit) {
      edges.push({
        from: fullId(sa.sentenceId, hit.id),
        to: fullId(e.sentenceId, e.partId),
        kind: e.status === 'discarded-by-pivot' ? 'contests' : 'endorses',
        score: 0.5,
        evidence: [`kw:${kw.filter(k => hit.content.includes(k)).join('|')}`],
      });
    }
  }

  // (c) 同枠再オープン:過去 unclosed frame と同じ opener が現文の setup に再出現。
  //     同一 openOp の未閉フレームが多数積もると爆発するため、openOp ごとに
  //     「最新の1件」だけへ張る(能動的に継続している枠を指す。古い同型枠は無視)。
  const setupC = sa.parts.find(p => p.label === 'setup');
  if (setupC) {
    const reopenOps = new Set(
      (sa.hits || [])
        .filter(h => h.offset >= setupC.start && h.offset < setupC.end)
        .map(h => h.opId)
    );
    const latestByOp = new Map(); // openOp → 最新の unclosed frame
    for (const fr of flow.unclosedFrames) {
      if (fr.sentenceId === sa.sentenceId) continue;
      if (!fr.openOp || !reopenOps.has(fr.openOp)) continue;
      const prev = latestByOp.get(fr.openOp);
      if (!prev || prev.sentenceId < fr.sentenceId) latestByOp.set(fr.openOp, fr);
    }
    for (const [openOp, fr] of latestByOp) {
      edges.push({
        from: fullId(sa.sentenceId, setupC.id),
        to: fullId(fr.sentenceId, 'frame'),
        kind: 'reopens',
        score: 0.4,
        evidence: [`same-opener:${openOp}`],
      });
    }
  }

  // (d) 語彙エコー:過去 N=5 文の任意パートと内容語幹が重複
  //     ※ detectCrossRefs は applyFlow より前に呼ばれるため history に現文は
  //       まだ無い。slice(-5) で直近 5 文(全て過去)を採る(以前は slice(-5,-1)
  //       で直前文を誤って除外していた=接続層が死ぬ一因)。
  //     ※ echo は「distinctive(稀少)な語の反復」のみ採る。computeDocumentIdf が
  //       log(...)+1 で底上げするため raw idf(=idf-1=log((N+1)/(d+1)))で判定する。
  //       小文書(N<12)は idf が無意味なので間引かず素の語幹一致を採る(stem 検出の
  //       回帰テスト保護も兼ねる)。大文書では頻出語(理由/問題/思 等)を除外しノイズ抑制。
  const recent = flow.history.slice(-5).filter(h => h.sentenceId !== sa.sentenceId);
  const bigDoc = (flow.docSize ?? 0) >= 12;
  const echoKw = (content) => {
    const all = extractKeywords(content);
    if (!bigDoc || !idf || idf.size === 0) return all;
    return all.filter(w => ((idf.get(w) ?? 99) - 1) >= ECHO_RAW_IDF);
  };
  for (const p of sa.parts) {
    if (p.label !== 'claim' && p.label !== 'setup') continue;
    const kw = echoKw(p.content);
    if (kw.length < 1) continue;
    for (const prev of recent) {
      for (const pp of prev.parts) {
        const overlap = kw.filter(k => pp.content.includes(k));
        if (overlap.length < 1 || pp.content.length < 4) continue;
        // echo は弱い接続なので質を要求する:単語 1 個の一致だけでは張らない。
        //   ・2 語以上の一致(話題の連続) もしくは
        //   ・単一でも genuinely 希少な語(raw idf≥2.5 ≈ 文書の ~8% 以下)の一致
        // を「強い echo」とみなす。これで流れる散文の単語かすり合いノイズを除く。
        const strong = overlap.length >= 2 ||
          overlap.some(k => ((idf?.get(k) ?? 99) - 1) >= 2.5);
        if (!strong) continue;
        // raw idf 合計で重み付け(稀少語の一致ほど強い接続)。idf 無の時は 1.5 既定。
        const idfSum = overlap.reduce((s, k) => s + Math.max(0.5, (idf?.get(k) ?? 1.5) - 1), 0);
        edges.push({
          from: fullId(sa.sentenceId, p.id),
          to: fullId(prev.sentenceId, pp.id),
          kind: 'echoes',
          score: Math.min(0.55, 0.18 + 0.08 * idfSum),
          evidence: [`kw-overlap:${overlap.join('|')}`],
        });
      }
    }
  }

  // (e) 列挙 discharge:現文に enum.ordinal があれば、直近の未充足コミットを指す。
  //     北極星「予告(三つあります)→回収(まず/次に/最後に)」の跨文連結。
  const ordinals = (sa.operations?.instances || []).filter(i => i.opId === 'enum.ordinal');
  if (ordinals.length) {
    const open = [...flow.forwardCommitments].reverse()
      .find(c => c.sentenceId !== sa.sentenceId && c.filled < (c.count ?? Infinity));
    if (open) {
      const ord = ordinals[0];
      const slotNo = (open.filled ?? 0) + 1;
      const terminal = ord.ordinal === -1;
      edges.push({
        from: fullId(sa.sentenceId, sa.parts[0]?.id ?? 'p0'),
        to: fullId(open.sentenceId, 'commit'),
        kind: 'discharges',
        score: terminal ? 0.85 : 0.8,
        evidence: [
          open.head ? `commit:${open.count}×${open.head}` : `commit:${open.count}`,
          terminal ? 'slot:terminal' : `slot:${slotNo}/${open.count ?? '?'}`,
        ],
      });
    }
  }

  // (f) 接続辞による論理連結:文頭の接続辞が直近の claim/setup へ関係を張る。
  //     「思考間の emergent connection」を表層マーカーから明示的に回収する。
  const conn = leadingConnective(sa.text || '');
  if (conn) {
    const prevWithClaim = [...flow.history].reverse()
      .find(h => h.sentenceId !== sa.sentenceId &&
                 h.parts.some(pp => pp.label === 'claim' || pp.label === 'setup'));
    if (prevWithClaim) {
      const target = [...prevWithClaim.parts].reverse()
        .find(pp => pp.label === 'claim' || pp.label === 'setup');
      edges.push({
        from: fullId(sa.sentenceId, sa.parts[0]?.id ?? 'p0'),
        to: fullId(prevWithClaim.sentenceId, target.id),
        kind: conn.kind,
        score: 0.6,
        evidence: [`connective:${conn.surface}`],
      });
    }
  }

  // (g) 照応解決:指示詞 → 先行詞。談話接続の中核(echo の表層反復より上位の接続)。
  //     「その N / この N」は名詞語幹を含む直近文へ橋渡し(bridging)、文頭の bare
  //     指示詞(これは/それが)は直前の命題全体を指す。1 文 1 エッジに絞り誤接続を防ぐ。
  const anaph = resolveAnaphora(sa, flow);
  if (anaph) edges.push(anaph);

  // スコア降順で重複を除く(同一 to に対して最高スコアのみ残す)
  const bestByTo = new Map();
  for (const e of edges) {
    const prev = bestByTo.get(e.to);
    if (!prev || prev.score < e.score) bestByTo.set(e.to, e);
  }
  return [...bestByTo.values()].sort((a, b) => b.score - a.score);
}

/** 内容語幹を抽出する。
 *  日本語の内容は「単漢字 + 送り仮名」(譲る/思う/良い) や単漢字名詞(席/熱) が
 *  大半なので、2連続漢字に限ると核概念の大半を取りこぼす(接続層が死ぬ原因)。
 *  ここでは漢字連なりを語幹として採り、送り仮名は語幹の漢字部に正規化する。
 *  これにより 譲る/譲って/譲り が全て語幹「譲」で一致し、跨文の反復が見える。
 *  文法的に頻出する単漢字は stoplist で抑制(IDF が +1 で底上げされ実効しないため)。 */
const KW_STOP = new Set([
  '事','物','人','方','様','的','化','性','感','時','所','中','上','下',
  '前','後','間','内','外','点','目','話','気','的','者','形','面','度','本',
  '一','二','三','四','五','六','七','八','九','十','百','千','万','億',
]);
function extractKeywords(text) {
  const out = new Set();
  // 漢字連なり(語幹)。送り仮名はここで自然に落ちる(漢字部のみ抽出されるため)。
  const kanji = text.match(/[一-龥]+/g) || [];
  for (const w of kanji) {
    if (w.length >= 2) out.add(w);            // 複合語幹 (気持/大事/問題)
    else if (!KW_STOP.has(w)) out.add(w);     // 単漢字語幹 (席/譲/熱) — stoplist 除く
  }
  // カタカナ語 (2文字以上)
  const kata = text.match(/[ァ-ヶ]{2,}/g) || [];
  for (const w of kata) out.add(w);
  return [...out];
}

/** 文頭の接続辞を関係種別へ写像する。表層の論理マーカーから跨文関係を回収。 */
const CONNECTIVES = [
  { re: /^(?:だから|ですから|そのため|したがって|よって|なので|それで)/, kind: 'infers',      label: '帰結' },
  { re: /^(?:つまり|要するに|すなわち|言い換え(?:る|れば)|ということは)/,  kind: 'reformulates', label: '言い換え' },
  { re: /^(?:でも|しかし|けれど(?:も)?|ところが|とはいえ|逆に|一方)/,      kind: 'contrasts',    label: '対比' },
  { re: /^(?:例えば|たとえば)/,                                          kind: 'exemplifies',  label: '例示' },
  { re: /^(?:また|さらに|それに|加えて|そして|しかも)/,                    kind: 'adds',         label: '追加' },
  { re: /^(?:結局|結論(?:と|から)|要は)/,                                kind: 'concludes',    label: '結論' },
];
function leadingConnective(text) {
  const t = text.replace(/^[\s、,]+/, '');
  for (const c of CONNECTIVES) {
    const m = t.match(c.re);
    if (m) return { surface: m[0], kind: c.kind, label: c.label };
  }
  return null;
}

/** echo は「稀少語(高 raw idf)の反復」のみ採る閾値。raw idf = log((N+1)/(d+1))。
 *  1.5 は概ね「文書の ~22% 以下にしか出ない語」に相当。これ未満(理由/問題/思 等の
 *  頻出語)の一致は echo として張らない=表層反復ノイズの抑制。小文書では適用しない。 */
const ECHO_RAW_IDF = 1.5;

/** 連体指示詞 + 名詞(語幹)。bridging 照応「その N」「この N」の検出。 */
const ADNOMINAL_DEMON = /(?:この|その|あの|こうした|そうした|こういう|そういう|あんな|そんな|こんな)([一-龥]+[一-龥ァ-ヶ]*|[ァ-ヶ]{2,})/;
/** 文頭 bare 指示詞(命題照応)。これは/それが/あれを 等が文頭主題に立つ場合。 */
const PRONOUN_TOPIC = /^[\s、,]*(これ|それ|あれ|これら|それら|そこ|ここ|こちら|そちら|彼ら|彼女|彼)(?:は|が|を|に|も|の|って)/;

/**
 * 照応解決:指示詞から先行詞へ refers エッジを 1 本だけ張る。
 *  (g1) 連体指示詞「その N」→ 名詞語幹 N を含む直近の claim/setup へ橋渡し。
 *       先行詞名詞が見つからなければ張らない(誤接続回避=高精度優先)。
 *  (g2) 文頭 bare 指示詞「これは…」→ 直前文の命題(claim/setup)全体を指す。
 * @returns {object|null} edge または null
 */
function resolveAnaphora(sa, flow) {
  const text = sa.text || '';
  const history = (flow.history || []).filter(h => h.sentenceId !== sa.sentenceId);
  if (!history.length) return null;
  const fullId = (sid, pid) => `${sid}.${pid}`;
  const fromPart = sa.parts[0]?.id ?? 'p0';
  const isContentPart = pp => pp.label === 'claim' || pp.label === 'setup';

  // (g1) 連体指示詞 + 名詞 → bridging
  const adn = text.match(ADNOMINAL_DEMON);
  if (adn) {
    const noun = adn[1];
    const stem = (noun.match(/[一-龥]+/)?.[0]) || noun; // 漢字語幹を優先キーに
    if (stem.length >= 1) {
      for (let i = history.length - 1; i >= 0; i--) {
        const h = history[i];
        const tp = [...h.parts].reverse().find(pp => isContentPart(pp) && pp.content.includes(stem));
        if (tp) {
          return {
            from: fullId(sa.sentenceId, fromPart),
            to: fullId(h.sentenceId, tp.id),
            kind: 'refers',
            score: 0.7,
            evidence: [`anaphor:${adn[0]}`, `antecedent:${stem}`],
          };
        }
      }
      return null; // 先行詞名詞が無い連体指示詞は接続しない
    }
  }

  // (g2) 文頭 bare 指示詞 → 直前命題の照応
  const pm = text.match(PRONOUN_TOPIC);
  if (pm) {
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      const tp = [...h.parts].reverse().find(isContentPart);
      if (tp) {
        return {
          from: fullId(sa.sentenceId, fromPart),
          to: fullId(h.sentenceId, tp.id),
          kind: 'refers',
          score: 0.55,
          evidence: [`anaphor:${pm[1]}`, 'proposition-anaphora'],
        };
      }
    }
  }
  return null;
}

/**
 * P1.3: 文書全体の DF を集計して IDF マップを返す。
 * extractKeywords と同じ抽出ロジックを用いる。
 * @param {Array<{text:string}>} sentences
 * @returns {Map<string,number>} keyword → idf (log scale)
 */
export function computeDocumentIdf(sentences) {
  const df = new Map();
  const N = sentences.length || 1;
  for (const s of sentences) {
    const seen = new Set(extractKeywords(s.text || ''));
    for (const w of seen) df.set(w, (df.get(w) || 0) + 1);
  }
  const idf = new Map();
  for (const [w, d] of df) idf.set(w, Math.log((N + 1) / (d + 1)) + 1);
  return idf;
}

/**
 * IDF 閾値で「中身のある」語のみ残す。閾値はおよそ「文書の 1/3 以下に
 * しか出ない語」を採用。idf が無いときは素のキーワードを返す。
 */
function keywordsByIdf(text, idf, minIdf = 0.8) {
  const all = extractKeywords(text);
  if (!idf || idf.size === 0) return all;
  return all.filter(w => (idf.get(w) ?? 99) >= minIdf);
}
