// _tmp_pipeline/compose.mjs
// =====================================================================
// 合成エンジン (COMPOSE) — 構成性原則の中核
// ---------------------------------------------------------------------
// 各 hit を「単一ラベル」ではなく「構成素列 + 合成効果」として再記述する。
// op id は構成素合成から創発するラベルにすぎず、id だけ並べる旧来の表示は
// 構造的盲目 (compositional blindness) を生む。
//
// 入力: hit (opId, surface, offset, length, voice, thoughtLayer, …)
//       + 文テキスト + 周辺 hit 群 + spans + quotes
// 出力: hit.constituents     構成素列 (順序付き)
//       hit.compositionalNote 合成効果の日本語注釈
//       hit.licensors        この解釈を許可した周辺要素 (op id / morph)
//
// 設計原則:
//   1. 既知形態素は morphology.mjs から自動分解。
//   2. contextual な形態素 (例: 「とか」「もう」「と」) は本モジュールの
//      解決規則で周辺要素を見て役割確定。
//   3. op ごとに「合成効果文」を生成する小関数群 (COMPOSITION_RECIPE) を持ち、
//      テンプレに該当しない op は構成素列を述べる汎用注釈で補う。
//   4. 何が起きているか言える限り常に具体的に書く。
//      抽象ラベル (「メタ効果」など) は禁止。
// =====================================================================

import { decomposeSurface, MORPH_BY_SURFACE } from './morphology.mjs';
import { OP_BY_ID } from './lexicon.mjs';

/**
 * @typedef {{
 *   morph:string, role?:string, contributes_ja?:string,
 *   contextual?:boolean, unknown?:boolean,
 *   resolvedFrom?:string,
 * }} Constituent
 */

// ---------- 文脈による形態素役割の確定 -----------------------------------

/**
 * 「とか」の役割を周辺で確定。
 *  - 直前に「場合」or 条件枠 → EXEMPLIFIER-IN-CONDITION (条件枠内一例)
 *  - 直前に並列名詞 (X や Y …) → LIST-CONTINUATION
 *  - それ以外 → EXEMPLIFIER-HEDGE (既定)
 */
function resolveToka(text, hitOffset, hitLength) {
  const before = text.slice(Math.max(0, hitOffset - 6), hitOffset);
  if (/場合$/.test(before) || /時$/.test(before) || /(?:なら|たら|だら)$/.test(before)) {
    return { role: 'EXEMPLIFIER-IN-CONDITION',
             contributes_ja: '条件/状況枠内で一例として提示しつつ列挙未尽性を残す',
             resolvedFrom: '直前に条件枠標識(場合/時/たら/なら)' };
  }
  if (/(?:や|と|・|、)\s*[\u3040-\u30FF\u4E00-\u9FFF]{1,8}$/.test(before)) {
    return { role: 'LIST-CONTINUATION',
             contributes_ja: '並列列挙の未尽宣言(他にもありうる)',
             resolvedFrom: '直前に並列接続' };
  }
  return null; // 既定のまま
}

/**
 * 「もう」の役割を周辺で確定。
 *  - 直後/同文に行為動詞否定 → RESIGNATION-CLOSURE (諦観)
 *  - 直後に程度副詞 (ちょっと/少し) → INCREMENT-CHAIN
 *  - 直後に「やはり/やっぱ」 → EVOCATION-OF-EXPECTATION
 */
function resolveMou(text, hitOffset, hitLength) {
  const after = text.slice(hitOffset + hitLength, hitOffset + hitLength + 12);
  if (/^(?:ちょっと|少し|一[歩段])/.test(after)) {
    return { role: 'INCREMENT-CHAIN',
             contributes_ja: '段階的増分の連鎖(さらに一段進める)を担う先頭副詞',
             resolvedFrom: '直後に程度副詞' };
  }
  if (/^(?:やはり|やっぱり|やっぱ)/.test(after)) {
    return { role: 'EVOCATION-OF-EXPECTATION',
             contributes_ja: '聴き手予期を召喚する先頭副詞(直後の事前合致確認と共起)',
             resolvedFrom: '直後に EXPECTATION-CONFIRM 標識' };
  }
  if (/(?:できない|無理|ない|られない|やめ|諦め)/.test(after)) {
    return { role: 'RESIGNATION-CLOSURE',
             contributes_ja: '行為可能性閉鎖を伴う諦観/状況終結',
             resolvedFrom: '直後に否定/不能語' };
  }
  return null;
}

/**
 * 「と」の役割を周辺で確定。
 *  - 直前に発話/思考動詞 → QUOTATIVE-MARKER
 *  - 直後に節 + 句読点 → CONDITIONAL-ANTECEDENT (P と Q)
 *  - 並列名詞間 → LIST-AND
 */
function resolveTo(text, hitOffset, hitLength) {
  const before = text.slice(Math.max(0, hitOffset - 4), hitOffset);
  const after = text.slice(hitOffset + hitLength, hitOffset + hitLength + 4);
  if (/(?:言|思|考|聞|見|感じ)[わいうえおっ]?$/.test(before)) {
    return { role: 'QUOTATIVE-MARKER',
             contributes_ja: '直前の発話/思考動詞に引用句を結びつける',
             resolvedFrom: '直前に発話/思考動詞' };
  }
  if (/^[、，]/.test(after)) {
    return { role: 'CONDITIONAL-ANTECEDENT',
             contributes_ja: '前部命題を条件として後続に帰結を要求する節境界標識',
             resolvedFrom: '直後が節境界' };
  }
  return null;
}

/**
 * 「た」の役割を周辺で確定。
 *  - 直後に「ら」「とか」「場合」「時」 → CONDITION-IN-PERFECTIVE
 *  - それ以外 → PERFECTIVE
 */
function resolveTa(text, hitOffset, hitLength) {
  const after = text.slice(hitOffset + hitLength, hitOffset + hitLength + 4);
  if (/^(?:ら|場合|時|とき|とか)/.test(after)) {
    return { role: 'CONDITION-IN-PERFECTIVE',
             contributes_ja: '完了相を条件枠と合成し「P 完了 → Q」の前件相を担う',
             resolvedFrom: '直後に条件枠標識' };
  }
  return null;
}

/**
 * 「ね」の役割を周辺で確定。
 *  - 文末 → COMMON-GROUND-APPEAL
 *  - 文中で名詞 + ね → INTERNAL-MUSING-MARK
 */
function resolveNe(text, hitOffset, hitLength) {
  const after = text.slice(hitOffset + hitLength, hitOffset + hitLength + 2);
  if (/^[。．？！\n]?$/.test(after)) {
    return null; // 既定 = COMMON-GROUND-APPEAL
  }
  return { role: 'INTERNAL-MUSING-MARK',
           contributes_ja: '文中位置で自己向け感慨/独白を担う(共有確認ではない)',
           resolvedFrom: '文末位置でない' };
}

/**
 * 「けど」の役割を周辺で確定。
  *  - 文末 → EXPLAIN-HEDGE-CLOSE (留保開示の閉じ)
 *  - 文中 → CONCESSIVE-OPEN
 */
function resolveKedo(text, hitOffset, hitLength) {
  const after = text.slice(hitOffset + hitLength, hitOffset + hitLength + 2);
  if (/^[。．？！\n]?$/.test(after)) {
    return { role: 'EXPLAIN-HEDGE-CLOSE',
             contributes_ja: '留保したまま発話を閉じ、聴き手に解釈/応答の余地を残す',
             resolvedFrom: '文末位置' };
  }
  return null;
}

/**
 * 「から」の役割を周辺で確定。
 *  - 直前に発話/思考動詞引用 → QUOTATIVE-SOURCE
 *  - 文末/読点前 → CAUSAL-DEPENDENT (既定)
 */
function resolveKara(text, hitOffset, hitLength) {
  const before = text.slice(Math.max(0, hitOffset - 4), hitOffset);
  if (/(?:駅|学校|家|東京|空港)$/.test(before)) {
    return { role: 'ABLATIVE-SOURCE',
    
  

      contributes_ja: '物理的起点を導入',
             resolvedFrom: '直前に場所名詞' };
  }
  return null;
}

const CONTEXTUAL_RESOLVERS = {
  'とか':  resolveToka,
  'もう':  resolveMou,
  'と':    resolveTo,
  'た':    resolveTa,
  'ね':    resolveNe,
  'けど':  resolveKedo,
  'から':  resolveKara,
};

/**
 * 構成素列の contextual な要素を文脈で確定する。
 * @param {Constituent[]} constituents
 * @param {string} text   文テキスト
 * @param {number} baseOffset hit.offset (構成素先頭の文書内オフセット)
 */
function resolveContextual(constituents, text, baseOffset) {
  let cursor = baseOffset;
  for (const c of constituents) {
    if (c.contextual && CONTEXTUAL_RESOLVERS[c.morph]) {
      const r = CONTEXTUAL_RESOLVERS[c.morph](text, cursor, c.morph.length);
      if (r) {
        c.role = r.role;
        c.contributes_ja = r.contributes_ja;
        c.resolvedFrom = r.resolvedFrom;
      }
    }
    cursor += c.morph.length;
  }
}

// ---------- 合成効果文の生成 -------------------------------------------

/**
 * op id ごとの合成効果テンプレ。constituents を受け取り、
 * その op がなぜその効果になるかを日本語で説明する。
 * 未登録の op は generic 説明に fallback。
 * @type {Record<string, (cs:Constituent[], hit:any, text:string)=>string>}
 */
const COMPOSITION_RECIPE = {
  'META-CONVERSATIONAL-EFFECT': (cs) =>
    `他者発話 (受動形「言われ」) を完了負価相 (「ちゃっ」) で受け取り、条件帰結 (「たら」) と諦観副詞 (「もう」) を合成して「自分の行動可能性が閉ざされた」状況評価を談話に投入する。談話 move としては独立しておらず、これら 4 部品の合成効果である。`,

  'COUNTERFACTUAL-IDENTIFY': (cs) =>
    `引用化標識 (「って/という」) で前部命題を持ち上げ、認識動詞「分かる」+完了「た」で「同定が確定した」状態を作り、条件枠名詞「場合」で仮想/反事実枠を立て、例示緩和「とか」で「他にも類例があり得る一例」として提示する合成。単独で「反事実」を意味する形態素は無い ― 合成効果。`,

  'UNDERSTANDING-REPORT': (cs) =>
    `引用化標識「っていう/という」が直前命題を名詞修飾化し、「理解」(認識名詞) + 「です」(提示コピュラ) で「これが私の現時点の理解だ」と相手に提示する合成。 「報告」ではなく「同定された理解の差し出し」。`,

  'UNDERSTANDING-CHECK': (cs) =>
    `所有/指示語 + 「理解」 + 主題化「は」/手段「で」 + 評価語 (良かった/合って/大丈夫) の連鎖で、自己理解を相手の判定対象として差し出す合成。聴き手向け確認要請の illocutionary force はこの並びから創発する。`,

  'MUSING-MODAL': (cs) =>
    `近似連体「ような」+「気がし」(弱知覚動詞) + 接続「て」で、断定回避された弱い直観的印象を内側で立てる合成。「musing」は単一語ではなく、近似 + 弱知覚の二段階による効果。`,

  'POTENTIAL-PERMISSION': (cs) =>
    `動詞語幹 + 潜在性助動詞「うる/える」で「それが許容されうる」評価を担う合成。話者は事実主張ではなく「成り立ちうる」可能性枠の認定を行っている。`,

  'CONVICTION-CONDITIONAL': (cs) =>
    `名詞「確信」 + 可能補助「できる」 + 説明モード「のです」 + 条件「あれば」が連結して、「主観的確信が成立した場合に限り」という前件を立てる合成。単純な条件文より話者主観性が一層強い。`,

  'DEEPEN-PROBE-OPEN': (cs) =>
    `増分副詞「もうちょっと」+ 動詞「踏み込ん」+ 接続「で」+ 引用化「と」が並んで「現状より一段抽象/関与度を上げて言うと」という探索宣言を作る合成。`,

  'TOPIC-PIVOT-MARK': (cs) =>
    `緩衝副詞「ちょっと」+ 名詞「話/問い」+ 動詞「変える」+ 引用化「と」で、明示的話題転換を聴き手に予告する合成。`,

  'STRATEGIC-CALCULUS': (cs) =>
    `名詞「利己/打算/得」+ 評価コピュラの組み合わせで、行為動機を「計算可能な損得勘定」枠に再定位する合成。`,

  'GENRE-CITATION': (cs) =>
    `ジャンル名詞 (ドラマ/映画/小説) + 場所助詞「で」+ 評価形容詞「よくある」+ 「設定」で、当該命題を「ジャンル定型としてよく見る型」枠に投げ込む合成。`,

  'EXAM-FRAME-MARK': (cs) =>
    `名詞「テスト/問題/第 N 問」+ 評価/状態提示で、当該局面を「査定空間」として枠付ける合成。教師/生徒の役割が暗黙に呼び出される。`,

  'RELIEF-EXCLAIM': (cs) =>
    `感動詞「あ」+ 評価形容詞「危ね/よかった」の単独配置で、瞬間的情動表出を行う合成。命題内容ではなく情動を会話面に直接置く効果。`,

  'PERSPECTIVE-STAGE-OPEN': (cs) =>
    `名詞/句 + 引用化「って/という」+ 主題化「のは」が連結して、後続が「この視座から/この対象について」評価される舞台を組む合成。定義開示ではない ― 視座セットアップ。`,
};

/**
 * 一般 fallback: 構成素 role を並べて「X (役割) + Y (役割) + … の合成」と書く。
 */
function genericComposition(cs) {
  const parts = cs
    .filter(c => !c.unknown && c.role)
    .map(c => `「${c.morph}」(${roleLabel(c.role)})`);
  if (!parts.length) return null;
  return `構成素 ${parts.join(' + ')} の合成として立ち上がる。`;
}

const ROLE_LABEL_JA = {
  'QUOTATIVE-MARKER':            '引用化',
  'QUOTATIVE-NOMINAL':           '引用名詞修飾',
  'COGNITION-VERB':              '認識動詞',
  'BELIEF-VERB':                 '信念動詞',
  'SAY-VERB':                    '発話動詞',
  'SAY-VERB-PASSIVE':            '発話受動形',
  'SAY-VERB-PASSIVE-STEM':       '発話受動語幹',
  'PERCEPTION-VERB-WEAK':        '弱知覚動詞',
  'PERCEPTION-VERB':             '知覚動詞',
  'EVIDENTIAL-VERB':             '証拠動詞',
  'PERFECTIVE':                  '完了',
  'PROGRESSIVE':                 '進行',
  'COMPLETIVE-NEGATIVE-AFFECT':  '完了+負価評価',
  'PASSIVE-OR-POTENTIAL':        '受動/可能',
  'CAUSATIVE':                   '使役',
  'CONDITIONAL-PERFECTIVE':      '完了条件',
  'CONDITIONAL-PROVISIONAL':     '仮定条件',
  'CONDITIONAL-TOPICAL':         '前提条件',
  'CONDITIONAL-ANTECEDENT':      '条件節境界',
  'HYPOTHETICAL-MARK':           '仮定枠標',
  'CONDITION-FRAME-NOUN':        '条件枠名詞',
  'TEMPORAL-FRAME-NOUN':         '時間枠名詞',
  'EXEMPLIFIER-HEDGE':           '例示+緩和',
  'EXEMPLIFIER-IN-CONDITION':    '条件枠内一例',
  'EXEMPLIFIER-DOWNGRADE':       '例示+引下げ',
  'APPROXIMATIVE-QUOTE':         '近似引用化',
  'APPROXIMATIVE-ADNOMINAL':     '近似連体',
  'APPROXIMATIVE':               '近似',
  'APPROXIMATIVE-CORE':          '様態語幹',
  'EXEMPLIFY-MARK':              '例示宣言',
  'LIST-CONTINUATION':           '列挙未尽',
  'EPISTEMIC-MUSE':              '自問低確信',
  'EPISTEMIC-MAYBE':             '可能性中度',
  'EPISTEMIC-CONJECTURE':        '推量',
  'EPISTEMIC-CONJECTURE-POLITE': '推量(丁寧)',
  'EPISTEMIC-EXPECT':            '論理期待',
  'POTENTIAL-PERMIT':            '潜在許容',
  'POTENTIAL-ABILITY':           '実行可能',
  'OBLIGATION':                  '義務',
  'NORMATIVE':                   '規範当為',
  'DISCOURSE-RESIGNATION':       '時点完了+諦観',
  'RESIGNATION-CLOSURE':         '可能性閉鎖',
  'INCREMENT-CHAIN':             '増分連鎖先頭',
  'EVOCATION-OF-EXPECTATION':    '予期召喚',
  'EXPECTATION-CONFIRM':         '予期合致',
  'MITIGATOR':                   '強度緩和',
  'INCREMENT-PROBE':             '増分要求',
  'DEEPEN-VERB':                 '深化動詞',
  'INTENSIFIER-EPISTEMIC':       '真理強化',
  'CLOSURE-MARK':                '終点宣言',
  'REFORMULATION-EQUIV':         '等価言い換え',
  'CAUSAL-DISCOURSE':            '談話因果',
  'CAUSAL-DERIVE':               '結論導出',
  'CAUSAL-DEPENDENT':            '従属因果',
  'CONCESSIVE-OPEN':             '逆接開き',
  'CONCESSIVE-OPEN-FORMAL':      '逆接(硬)',
  'CONCESSIVE-COUNTER':          '期待裏切り逆接',
  'COMMON-GROUND-APPEAL':        '共有確認要請',
  'INTERNAL-MUSING-MARK':        '内側感慨',
  'INFORM-NEW':                  '新情報通知',
  'SELF-DIRECTED':               '自己向け',
  'CASUAL-ASSERT':               '砕断言',
  'EXPLAIN-HEDGE-OPEN':          '説明+留保開き',
  'EXPLAIN-HEDGE-CLOSE':         '説明+留保閉じ',
  'EXPLAIN-HEDGE-FORMAL':        '説明+留保(硬)',
  'EXPLAIN-NOMINAL':             '説明モード',
  'EXPLAIN-NOMINAL-FORMAL':      '説明モード(硬)',
  'TOPIC-SHIFT':                 '話題転換',
  'QUESTION-SHIFT':              '問い入替',
  'TANGENT-MARK':                '副次分岐',
  'TOPIC-PIVOT-FORMAL':          '話題転換(改)',
  'AFFECT-RELIEF':               '安堵情動',
  'AFFECT-RELIEF-POS':           '好転安堵',
  'AFFECT-RISK':                 '危険評価',
  'AFFECT-AVERSION':             '忌避評価',
  'ROLE-NOUN':                   '社会役割名詞',
  'PERSON-NOUN':                 '属性人物名詞',
  'PERSPECTIVE-STAGE-OPEN-PHRASE': '視座導入句',
  'STAGE-OPEN-INSTANCE':          '視座導入 (の=instance, 話者近接)',
  'STAGE-OPEN-FACT':              '視座導入 (こと=typed-fact, 普遍)',
  'STAGE-OPEN-INSTANCE-ALSO':     '視座導入 (の+も=追加列挙)',
  'ESTABLISHED-CONVENTION-FRAME': '取り決めフレーム (〜ということになっている)',
  'WORDING-SEARCH-MUSE':          '語選び自問 (〜っていうのかな)',
  'CONDITION-IN-PERFECTIVE':     '条件付完了相',
  'QUOTATIVE-SOURCE':            '引用源',
  'ABLATIVE-SOURCE':             '起点',
};

function roleLabel(role) {
  return ROLE_LABEL_JA[role] || role;
}

/**
 * 単一 hit に構成素列と合成注釈を付与 (in-place)。
 * @param {any} hit
 * @param {string} text  文テキスト
 */
export function composeHit(hit, text) {
  if (!hit.surface) return hit;
  const decomposed = decomposeSurface(hit.surface);
  resolveContextual(decomposed, text, hit.offset);
  hit.constituents = decomposed;
  // 合成効果文
  const recipe = COMPOSITION_RECIPE[hit.opId];
  let note = recipe
    ? recipe(decomposed, hit, text)
    : (genericComposition(decomposed) || '構成素を分解できない (未知形態素列)');
  // 引用関係を合成注釈に追記 (Phase 4A: 全 op に引用との関係を貫通)
  if (hit.quoteRelation) {
    note += ' ' + quoteRelationNote(hit);
  }
  hit.compositionalNote = note;
  // licensors: contextual で resolvedFrom を持つ構成素を記録
  hit.licensors = decomposed
    .filter(c => c.resolvedFrom)
    .map(c => ({ morph: c.morph, role: c.role, by: c.resolvedFrom }));
  return hit;
}

/**
 * quoteRelation/quoteScope を日本語の補足文に変換
 */
function quoteRelationNote(hit) {
  const r = hit.quoteRelation;
  const s = hit.quoteScope || {};
  const srcLabel = ({
    self: '語り手自身',
    addressee: '聴き手予期',
    generic: '一般的事実',
    hypothetical: '仮想話者',
    unattributed: '出所未特定',
  })[s.source] || (s.source && s.source.startsWith('third:') ? `第三者「${s.source.slice(6)}」` : (s.source || '?'));
  const useLabel = ({
    'cite-as-fact': '事実として引用',
    'cite-as-exemplar': '事例(type の一例)として掲示',
    'cite-as-hypothetical': '仮想として掲示',
    'cite-as-evoked-then-pivot': '聴き手予期を召喚→反転候補',
    'cite-as-self-musing': '自己思考として枠付け',
  })[s.rhetoricalUse] || s.rhetoricalUse || '?';
  const cited = s.citedSurface ? `「${s.citedSurface}」` : '';
  switch (r) {
    case 'inside-quote':
      return `【引用内】${cited} の内側に立つ op。声源=${srcLabel}, 修辞用法=${useLabel}。地の文 op ではなく引用された命題の一部であることに注意。`;
    case 'quote-host':
      return `【引用ホスト】この op 自身が引用枠を導入。被引用=${cited}, 声源=${srcLabel}, 修辞用法=${useLabel}。`;
    case 'exemplar-presenter':
      return `【事例提示】引用された命題そのものではなく、それを type の例として掲げる行為が主要 op。被引用=${cited}, 声源=${srcLabel}, 修辞用法=${useLabel}。`;
    default:
      return '';
  }
}

/**
 * 文単位で全 hit に合成情報を付与。
 * @param {string} text
 * @param {Array<any>} hits
 */
export function composeSentence(text, hits) {
  for (const h of hits) composeHit(h, text);
  return hits;
}

export { roleLabel as _roleLabel };
