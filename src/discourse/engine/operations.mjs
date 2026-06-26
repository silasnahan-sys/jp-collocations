// _tmp_pipeline/operations.mjs
// Phase 6 — 抽象操作層 (Operations over morpheme stream)
// =====================================================================
// 設計原則 (Phase 5 への反省を吸収):
//   A. 表面文字列のリストでなく **操作のクラス** を定義する。
//      「例えば」「とか」「やっぱり」「カント」のような特定文字列は
//      operation 定義に書かない。書くのは「どんな role の token が
//      どう並んだ時に何の操作と見なすか」だけ。
//   B. span 境界は **形態素 token の境界に整列** する。
//      文字途中で切れる / 単語をまたいで貪欲に伸びる、を構造的に禁ずる。
//   C. 各 operation は **mechanism_ja** を持つ。これは「何故そう判定したか」
//      の構造的説明で、ラベル名を日本語化したものではない。
//   D. extrapolation 可能であること: 同じ操作クラスのマーカーは
//      MORPH_ENTRIES に 1 行追加するだけで全 operation が新表面を扱える。
// ---------------------------------------------------------------------

import { decomposeSurface, MORPH_BY_SURFACE } from './morphology.mjs';

// ─────────────────────────────────────────────────────────────────────
// Token stream
// ─────────────────────────────────────────────────────────────────────
//   { start, end, surface, kind: 'morph'|'content', role?, contributes_ja? }
//   kind='morph'   : 形態素辞書 hit (機能語/接辞)
//   kind='content' : 辞書外 (内容語: 名詞・固有名・動詞語幹候補)
//                    content は更に script で分類:
//                      'katakana' (≥2 連続 ⇒ 外来語/固有名候補)
//                      'kanji'    (漢字列 ⇒ 内容名詞候補)
//                      'hiragana' (ひらがな列 ⇒ 動詞語幹/和語名詞候補)
//                      'mixed'    (混在)
// ─────────────────────────────────────────────────────────────────────

const KATAKANA = /^[ァ-ヶー]+$/;
const KANJI    = /^[一-龥々]+$/;
const HIRAGANA = /^[ぁ-ん]+$/;
const DIGITS   = /^[0-9０-９]+$/;

function classifyContent(s) {
  if (KATAKANA.test(s))  return 'katakana';
  if (KANJI.test(s))     return 'kanji';
  if (HIRAGANA.test(s))  return 'hiragana';
  if (DIGITS.test(s))    return 'digits';
  return 'mixed';
}

// 複合語境界ガードの除外 role: 単漢字でも漢字に隣接して独立形態素として
// 機能するもの(代名詞/一人称: 僕自身・私自身・俺様 等)。ここに無い単漢字
// 枠名詞(時/事/方…)だけが複合語内で content に吸収される。
const COMPOUND_GUARD_EXEMPT = new Set(['FIRST-PERSON']);

/**
 * 文字列を {start, end, kind, role, ...} の token 列に分解。
 * char offset は絶対位置 (元の text 内)。
 */
export function tokenize(text) {
  const tokens = [];
  let i = 0;
  let contentBuf = '';
  let contentStart = -1;
  const flushContent = () => {
    if (!contentBuf) return;
    // 内容語を script 境界で細分する(問題です→問題+です, 譲る→譲+る)。
    // 句読点は別 token (punct) なので contentBuf には入らない。
    const subs = contentBuf.match(/[一-龥々]+|[ァ-ヶー]+|[ぁ-ん]+|[0-9０-９]+|[^一-龥々ァ-ヶーぁ-ん0-9０-９]+/g) || [contentBuf];
    let off = contentStart;
    for (const s of subs) {
      tokens.push({
        start: off,
        end:   off + s.length,
        surface: s,
        kind: 'content',
        script: classifyContent(s),
      });
      off += s.length;
    }
    contentBuf = '';
    contentStart = -1;
  };
  // 句読点・空白・記号: 内容語の一部にせず独立 token 化(coverage を汚さない)
  const PUNCT = /[、。，．・！？!?「」『』（）()【】［］\[\]｛｝{}…―—\-―〜～\s]/;
  // morphology の貪欲最長一致を 1 文字ずつ走らせる
  while (i < text.length) {
    // (0) 句読点/空白を先に切り出す
    if (PUNCT.test(text[i])) {
      flushContent();
      let j = i;
      while (j < text.length && PUNCT.test(text[j])) j++;
      tokens.push({ start: i, end: j, surface: text.slice(i, j), kind: 'punct' });
      i = j;
      continue;
    }
    let matched = null;
    let entry = null;
    for (const [m, entries] of MORPH_BY_SURFACE) {
      if (text.slice(i, i + m.length) === m) {
        if (!matched || m.length > matched.length) {
          matched = m;
          entry = entries[0];
        }
      }
    }
    // 複合語境界の保護: 単漢字の形態素(時/事/方/所…)が漢字に挟まれている場合、
    // それは漢字複合語(時間/時代/事実)の内部を割っている=形態素ではなく内容語の
    // 一部。隣接漢字があれば morph 化を取り消し content へ送る(残渣 間 等を解消)。
    // ※ ENUM-COUNT(三点/三つ)は 2 文字形態素なので該当せず無影響。
    // ※ 代名詞/一人称(僕/私/俺)は「僕自身」の様に漢字前でも独立形態素なので除外。
    if (matched && matched.length === 1 && KANJI.test(matched) &&
        !COMPOUND_GUARD_EXEMPT.has(entry?.role)) {
      const prevKanji = i > 0 && KANJI.test(text[i - 1]);
      const nextKanji = (i + 1) < text.length && KANJI.test(text[i + 1]);
      if (prevKanji || nextKanji) { matched = null; entry = null; }
    }
    if (matched) {
      flushContent();
      tokens.push({
        start: i,
        end:   i + matched.length,
        surface: matched,
        kind: 'morph',
        role: entry?.role,
        contributes_ja: entry?.contributes_ja,
        contextual: entry?.contextual === true,
      });
      i += matched.length;
    } else {
      if (contentBuf === '') contentStart = i;
      contentBuf += text[i];
      i++;
    }
  }
  flushContent();
  return tokens;
}

// ─────────────────────────────────────────────────────────────────────
// Role 集合 (operation 側がパターンマッチに使う)
// 表面でなく role の集合で書くことで extrapolation を担保する。
// ─────────────────────────────────────────────────────────────────────
const ROLES = {
  FRAME_OPENERS: new Set([
    'HYPOTHETICAL-MARK',          // もし
    'EXEMPLIFY-MARK',             // 例えば
    'CONDITION-FRAME-NOUN',       // 場合
    'TEMPORAL-FRAME-NOUN',        // 時
    'CONDITIONAL-PERFECTIVE',     // たら
    'CONDITIONAL-PROVISIONAL',    // れば / ば
    'CONDITIONAL-TOPICAL',        // なら
  ]),
  QUOTATIVE: new Set([
    'QUOTATIVE-MARKER',   // と / って
    'QUOTATIVE-NOMINAL',  // という / っていう
  ]),
  EXEMPLIFIER: new Set([
    'EXEMPLIFIER-HEDGE',       // とか
    'EXEMPLIFIER-DOWNGRADE',   // なんか
    'APPROXIMATIVE-QUOTE',     // みたいな
  ]),
  HEDGES: new Set([
    'EPISTEMIC-MUSE',           // かな
    'EPISTEMIC-CONJEC',         // だろう
    'APPROXIMATIVE',            // みたい
    'APPROXIMATIVE-ADNOMINAL',  // ような
    'APPROXIMATIVE-CORE',       // よう
    'PERCEPTION-VERB-WEAK',     // 気がし
    'EVIDENTIAL-VERB',          // 見え
  ]),
  BELIEF_VERBS: new Set([
    'BELIEF-VERB',
    'COGNITION-VERB',
    'BELIEF-VERB-CITE-SELF',  // と思う (自己思考引用)
    'SAY-VERB',               // 言う (引用元の代理)
  ]),
  TAG_CONFIRMATION: new Set([
    'FINAL-PARTICLE-NE',     // ね
    'FINAL-PARTICLE-YO',     // よ
    'FINAL-PARTICLE-YONE',   // よね
    'CONFIRM-TAG',           // でしょ / じゃない(ですか)
  ]),
  SUBJECTIVE_ADVERBS: new Set([
    'SUBJECTIVE-ADVERB',     // やっぱり / やはり 等(morphology に登録があれば)
    'EMPHATIC-ADVERB',
    'EXPECTATION-CONFIRM',   // やっぱり/やはり の既存 role も同類と見なす (堅牢な主観評価)
    'EXPLAIN-HEDGE-OPEN',    // んですけど も 「語り手主観 + 聖域保留」の例
  ]),
  REIFYING_NOUNS: new Set([
    'REIFYING-NOUN',         // 選択 / 判断 / 理解 / 結論 / 姿勢 (morphology に登録があれば)
    'CONDITION-FRAME-NOUN',
    'TEMPORAL-FRAME-NOUN',
  ]),
  NOMINALIZERS: new Set([
    'NOMINALIZER',           // こと / の (morphology に登録があれば)
  ]),
  // 人称
  FIRST_PERSON: new Set([
    'FIRST-PERSON',
  ]),
  // 推論結合
  REASONING_LINKS: new Set([
    'REASONING-LINK',        // として / によって (登録要)
    'CAUSAL-LINK',           // から / ので (登録要)
  ]),
  // 結論的評価
  CONCLUSIVE_EVAL: new Set([
    'CONCLUSIVE-EVAL',       // 方がいい / べきだ (登録要)
  ]),
  // 連体指示
  DEMONSTRATIVE_ADNOMINAL: new Set([
    'DEMONSTRATIVE-ADNOMINAL', // こうした / そういう (登録要)
  ]),
  // 列挙コミット / 順序標識 (Phase 6.1)
  ENUM_COUNTS: new Set([
    'ENUM-COUNT',            // 二つ / 三つ / 三点 — 列挙すべき項目数の前方宣言
  ]),
  ENUM_ORDINALS: new Set([
    'ENUM-ORDINAL',          // まず / 一つ目 / 次に / 最後に — 列挙 slot の discharge
  ]),
};

// ─────────────────────────────────────────────────────────────────────
// Operation registry
// ─────────────────────────────────────────────────────────────────────
//   各 operation:
//     id           : 'frame.open' のようなドット階層
//     family       : 'frame' | 'voice' | 'reify' | 'argument' | 'enum' | 'recall' | 'hedge' | 'self' | 'meta'
//     mechanism_ja : なぜそう判定したかの構造的説明 (テンプレ可)
//     detect(tokens, ctx) → instances
//
//   各 instance:
//     { opId, family, span:{start,end}, evidenceTokenIds:[], mechanism_ja, depth?, sub? }
//   span は **必ず** evidence token の min(start)〜max(end) (Inclusive of all evidence).
// ─────────────────────────────────────────────────────────────────────

function spanOfTokens(tokens, ids) {
  let s = Infinity, e = -Infinity;
  for (const id of ids) {
    if (tokens[id].start < s) s = tokens[id].start;
    if (tokens[id].end   > e) e = tokens[id].end;
  }
  return { start: s, end: e };
}

const isContent  = t => t.kind === 'content';
const hasRole    = (t, set) => t.kind === 'morph' && set.has(t.role);
const isExemplifier = t => hasRole(t, ROLES.EXEMPLIFIER);
const isQuotativeNominal = t => t.kind === 'morph' && t.role === 'QUOTATIVE-NOMINAL';
const isFrameOpener = t => hasRole(t, ROLES.FRAME_OPENERS);

// ─────────────────────────────────────────────────────────────────────
// OP 1: frame.open
// 機構: FRAME_OPENERS の role を持つ token 1 つで成立。
//       depth は文内の出現順 (nesting 推定の足場)。
// ─────────────────────────────────────────────────────────────────────
function op_frame_open(tokens) {
  const out = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (!isFrameOpener(tokens[i])) continue;
    depth++;
    out.push({
      opId: 'frame.open',
      family: 'frame',
      span: spanOfTokens(tokens, [i]),
      evidenceTokenIds: [i],
      depth,
      mechanism_ja: `role=${tokens[i].role} の token が解釈枠を新規に開く (文内 depth=${depth})`,
      sub: tokens[i].role,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// OP 2: enum.cycle
// 機構: EXEMPLIFIER role の token が連続的に 2 回以上出現する区間。
//       span = 最初の content + 最初の exempli ... 最後の exempli + 直後の particle (あれば)。
//       3 回以上ならとくに「心内列挙」感が強い (intensity)。
// ─────────────────────────────────────────────────────────────────────
function op_enum_cycle(tokens) {
  // exempli token の index 列を集める
  const exIds = tokens.map((t, i) => isExemplifier(t) ? i : -1).filter(i => i >= 0);
  if (exIds.length < 2) return [];
  // 隣接性: 「とか」と「とか」の間に content + 何か少しの間隙のみ許す (≤4 token 間隔)
  const clusters = [];
  let cur = [exIds[0]];
  for (let k = 1; k < exIds.length; k++) {
    if (exIds[k] - cur[cur.length - 1] <= 5) cur.push(exIds[k]);
    else { if (cur.length >= 2) clusters.push(cur); cur = [exIds[k]]; }
  }
  if (cur.length >= 2) clusters.push(cur);
  const out = [];
  for (const cl of clusters) {
    // 最初の exempli の直前に content がある所まで巻き戻す (span 開始)
    let startId = cl[0];
    while (startId > 0 && (isContent(tokens[startId - 1]) || isExemplifier(tokens[startId - 1]))) startId--;
    // 最後の exempli の直後 particle (が/を/に/は/も/と) があれば含める
    let endId = cl[cl.length - 1];
    if (endId + 1 < tokens.length && tokens[endId + 1].kind === 'morph'
        && /^(が|を|に|は|も|と|の)$/.test(tokens[endId + 1].surface)) {
      endId++;
    }
    const evidence = [];
    for (let i = startId; i <= endId; i++) evidence.push(i);
    out.push({
      opId: 'enum.cycle',
      family: 'enum',
      span: spanOfTokens(tokens, evidence),
      evidenceTokenIds: evidence,
      mechanism_ja: `EXEMPLIFIER role が ${cl.length} 回連続出現 — 候補列挙の cycling (≥3 で心内列挙感が強まる)`,
      sub: cl.length >= 3 ? 'cycling-heavy' : 'cycling-light',
      intensity: cl.length >= 3 ? 'high' : 'normal',
      confidence: cl.length >= 3 ? 'high' : 'medium',
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// OP 3: np.multi-instance (人類≡状況の二重露光の構造的記述)
// 機構: content + EXEMPLIFIER + content + EXEMPLIFIER? + particle のパターン。
//       これは「個別実体」ではなく「カテゴリの実例セット」を立てる構造。
//       同一 NP が同時に (a) 人類 (b) 状況タイプ (c) 列挙対象 として使える。
// ─────────────────────────────────────────────────────────────────────
function op_np_multi_instance(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 2; i++) {
    if (!isContent(tokens[i])) continue;
    if (!isExemplifier(tokens[i + 1])) continue;
    // 後続に少なくとも 1 つ追加の content
    let j = i + 2;
    let hasSecondContent = false;
    let lastEx = i + 1;
    while (j < tokens.length && (isContent(tokens[j]) || isExemplifier(tokens[j]) || (tokens[j].kind === 'morph' && tokens[j].role === 'GENITIVE-NO') || tokens[j].surface === '方')) {
      if (isContent(tokens[j])) hasSecondContent = true;
      if (isExemplifier(tokens[j])) lastEx = j;
      j++;
    }
    if (!hasSecondContent) continue;
    // particle (が/を/に/は/も/と) で閉じる
    let endId = lastEx;
    if (j < tokens.length && tokens[j].kind === 'morph' && /^(が|を|に|は|も|と)$/.test(tokens[j].surface)) {
      endId = j;
    }
    const evidence = [];
    for (let k = i; k <= endId; k++) evidence.push(k);
    out.push({
      opId: 'np.multi-instance',
      family: 'np',
      span: spanOfTokens(tokens, evidence),
      evidenceTokenIds: evidence,
      mechanism_ja: '内容語 + EXEMPLIFIER + 内容語 (+ EXEMPLIFIER) + 格助詞 — 単一個体でなくカテゴリ実例セットを立てる NP 構造',
      facets_ja: ['人カテゴリ', '状況タイプ', '心内列挙対象'],
      confidence: 'medium',
    });
    // 重複防止のため次の探索開始位置を進める
    i = endId;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// OP 4: wrap.quote-nominal (引用名詞句による括り直し)
// 機構: QUOTATIVE-NOMINAL token (という / っていう) を中心に、
//       後続 content (名詞アンカー) と組んで「直前の言説を 1 個の object 化」。
// ─────────────────────────────────────────────────────────────────────
function op_wrap(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!isQuotativeNominal(tokens[i])) continue;
    // 直後の content (名詞アンカー) を見る
    let anchor = -1;
    for (let j = i + 1; j < Math.min(i + 4, tokens.length); j++) {
      if (isContent(tokens[j])) { anchor = j; break; }
      if (tokens[j].kind === 'morph' && tokens[j].surface === 'の') continue; // 「っていうのは」のような介在
      if (tokens[j].kind === 'morph' && /^(は|が|を|に)$/.test(tokens[j].surface)) break;
    }
    const evidence = anchor >= 0 ? [i, anchor] : [i];
    out.push({
      opId: 'wrap.quote-nominal',
      family: 'wrap',
      span: spanOfTokens(tokens, evidence),
      evidenceTokenIds: evidence,
      mechanism_ja: anchor >= 0
        ? 'QUOTATIVE-NOMINAL + 名詞アンカー — 先行発話を 1 個の object として括り直し、その「種類」に貼る'
        : 'QUOTATIVE-NOMINAL 単独 — 先行発話を object 化 (アンカー未確定)',
      sub: anchor >= 0 ? 'anchored' : 'bare',
      confidence: anchor >= 0 ? 'high' : 'low',
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// OP 5: recall.categorize  (話題化+暗黙対比の構造的記述)
// 機構: QUOTATIVE-NOMINAL + (の) + は — 直前を取り上げて「のカテゴリ」を topic 化。
//       wrap.quote-nominal のサブパターン。topic 化は対比を仕込む。
//
// **重要 (japanese.SE Q107594 / Q38822 / Q32387 / Q84227 参照)**:
//   表面が「というのは / っていうのは」「ということは / っていうことは」「というのも」
//   「ということになっている」「っていうのかな」では それぞれ意味機能が違う。
//   下表の sub / nuance_ja でその差を温存する。
//   - STAGE-OPEN-INSTANCE  : の=instance pronoun → 「このケース」 話者に近い具体例
//   - STAGE-OPEN-FACT      : こと=typed-fact     → 抽象的命題/推論基盤 普遍的
//   - STAGE-OPEN-INSTANCE-ALSO: の+も            → 追加列挙 (文末省略形は否定的婉曲)
//   - ESTABLISHED-CONVENTION-FRAME: 取り決め事実扱い
//   - WORDING-SEARCH-MUSE  : 語選びの自己内ぼかし
// ─────────────────────────────────────────────────────────────────────
const STAGE_OPEN_NUANCE = {
  'STAGE-OPEN-INSTANCE': {
    sub: 'instance-near-speaker',
    nuance_ja: 'の=「(特定の) 一つの instance」 (代名詞的) — 直前を「このケース/この一例」として身近に取り上げる。話者自身 (または仮想話者) が口にしそうな具体的場面の提示。口語的、ややぼかし。',
  },
  'STAGE-OPEN-FACT': {
    sub: 'abstract-universal-fact',
    nuance_ja: 'こと=「typed 事実 (抽象命題)」 — 直前を「人々の間で共有された一般事項」「だとすれば〜」の推論基盤として取り上げる。話者から距離があり普遍的。',
  },
  'STAGE-OPEN-INSTANCE-ALSO': {
    sub: 'instance-also-add',
    nuance_ja: 'の (instance) + も (also) — 「この一例**もまた**」 追加列挙の視座導入。文末省略形 (というのもね…) では否定的判断の婉曲。',
  },
  'ESTABLISHED-CONVENTION-FRAME': {
    sub: 'established-convention',
    nuance_ja: '「〜という事として設定/合意されている」 — 必ずしも真ではないが社会的/物語的に確定したものとして扱う取り決めフレーム。',
  },
  'WORDING-SEARCH-MUSE': {
    sub: 'wording-search',
    nuance_ja: 'の (nominalizer) + か (疑問) + な (再帰) — 直前を要約しつつ「〜とでも言おうか…」と自分でも言葉を探す自己内対話。',
  },
};
const STAGE_OPEN_COMPOSITES = new Set(Object.keys(STAGE_OPEN_NUANCE));

function op_recall_categorize(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    // ケース A: 単一 morpheme の stage-open composite を nuance 付きで拾う
    if (tokens[i].kind === 'morph' && STAGE_OPEN_COMPOSITES.has(tokens[i].role)) {
      const nu = STAGE_OPEN_NUANCE[tokens[i].role];
      out.push({
        opId: 'recall.categorize',
        family: 'recall',
        span: spanOfTokens(tokens, [i]),
        evidenceTokenIds: [i],
        mechanism_ja: `複合 morpheme 「${tokens[i].surface}」 — ${nu.nuance_ja}`,
        sub: nu.sub,
        stageOpenRole: tokens[i].role,
        nuance_ja: nu.nuance_ja,
        confidence: 'high',
      });
      continue;
    }
    if (!isQuotativeNominal(tokens[i])) continue;
    // ケース B: QUOTATIVE-NOMINAL + (の)? + は / こと + は の分解パターン
    let endId = -1;
    let route = null;
    if (tokens[i + 1] && tokens[i + 1].surface === 'の' && tokens[i + 2] && tokens[i + 2].surface === 'は') {
      endId = i + 2;
      route = 'instance-near-speaker';
    } else if (tokens[i + 1] && tokens[i + 1].surface === 'は') {
      endId = i + 1;
      route = 'topic-direct';
    } else if (tokens[i + 1] && tokens[i + 1].surface === 'こと' && tokens[i + 2] && tokens[i + 2].surface === 'は') {
      endId = i + 2;
      route = 'abstract-universal-fact';
    }
    if (endId < 0) continue;
    const evidence = [];
    for (let k = i; k <= endId; k++) evidence.push(k);
    const routeNuance = {
      'instance-near-speaker':    'の=「(特定の) 一つの instance」 — 直前を「このケース」として身近に topic 化 (の-ルート)',
      'topic-direct':             '直接 topic 化 — 直前を取り上げて話題化 (中立)',
      'abstract-universal-fact':  'こと=「typed 事実」 — 直前を抽象命題/推論基盤として取り上げる (こと-ルート, 普遍的)',
    }[route];
    out.push({
      opId: 'recall.categorize',
      family: 'recall',
      span: spanOfTokens(tokens, evidence),
      evidenceTokenIds: evidence,
      mechanism_ja: `QUOTATIVE-NOMINAL + topic 化 (decomposed) — ${routeNuance}`,
      sub: route,
      nuance_ja: routeNuance,
      confidence: route === 'topic-direct' ? 'medium' : 'high',
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// OP 6: hedge.cluster
// 機構: HEDGES role の token 1 つにつき 1 instance。
//       同一 clause 内に 2 つ以上あれば cluster と判定。
// ─────────────────────────────────────────────────────────────────────
function op_hedge(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!hasRole(tokens[i], ROLES.HEDGES)) continue;
    out.push({
      opId: 'hedge',
      family: 'hedge',
      span: spanOfTokens(tokens, [i]),
      evidenceTokenIds: [i],
      mechanism_ja: `HEDGES 集合に属する role=${tokens[i].role} の token — 主張の commitment を弱める`,
      sub: tokens[i].role,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// OP 7: voice.shift-cluster
// 機構: SUBJECTIVE_ADVERBS + CONCLUSIVE_EVAL が同一文に共起する場合、
//       両者の span をまとめて「想像話者声への滑り込み」と判定。
//       ※ こちらは role 集合がまだ MORPH 辞書に乏しい場合は空を返す
//       (extrapolation hook: morphology 側にマーカーを追加するだけで効く)
// ─────────────────────────────────────────────────────────────────────
function op_voice_shift(tokens) {
  const subjIds = tokens.map((t, i) => hasRole(t, ROLES.SUBJECTIVE_ADVERBS) ? i : -1).filter(i => i >= 0);
  const concIds = tokens.map((t, i) => hasRole(t, ROLES.CONCLUSIVE_EVAL) ? i : -1).filter(i => i >= 0);
  if (subjIds.length === 0 && concIds.length === 0) return [];
  const out = [];
  // それぞれ単独 instance + 共起なら cluster instance
  for (const id of subjIds) {
    out.push({
      opId: 'voice.subjective-marker',
      family: 'voice',
      span: spanOfTokens(tokens, [id]),
      evidenceTokenIds: [id],
      mechanism_ja: '主観副詞 — 後続を「ある話者の主観評価」として枠付ける (声源候補が立ち上がる)',
    });
  }
  for (const id of concIds) {
    out.push({
      opId: 'voice.conclusive-eval',
      family: 'voice',
      span: spanOfTokens(tokens, [id]),
      evidenceTokenIds: [id],
      mechanism_ja: '結論的評価 ending — 地の声の論証でなく「ある話者が辿り着く判定」の声色',
    });
  }
  if (subjIds.length && concIds.length) {
    const all = [...subjIds, ...concIds].sort((a, b) => a - b);
    out.push({
      opId: 'voice.shift-cluster',
      family: 'voice',
      span: spanOfTokens(tokens, [all[0], all[all.length - 1]]),
      evidenceTokenIds: all,
      mechanism_ja: '主観副詞 + 結論的評価 ending が同一文に共起 — 明示引用記号なしで「想像話者の声」への滑り込みを示唆',
      intensity: 'high',
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// OP 8: argument.typing  (役割明示の としては / として / によって)
// 機構: 内容語 + REASONING_LINKS role の token — 直前 NP を「推論内の何の役」かラベル付け。
// ─────────────────────────────────────────────────────────────────────
function op_argument_typing(tokens) {
  const out = [];
  for (let i = 1; i < tokens.length; i++) {
    if (!hasRole(tokens[i], ROLES.REASONING_LINKS)) continue;
    // 直前 content が argument
    let argStart = i;
    for (let j = i - 1; j >= 0; j--) {
      if (isContent(tokens[j]) || (tokens[j].kind === 'morph' && tokens[j].role === 'GENITIVE-NO')) argStart = j;
      else break;
    }
    const evidence = [];
    for (let k = argStart; k <= i; k++) evidence.push(k);
    out.push({
      opId: 'argument.typing',
      family: 'argument',
      span: spanOfTokens(tokens, evidence),
      evidenceTokenIds: evidence,
      mechanism_ja: `内容語 + role=${tokens[i].role} — 直前 NP を「推論内の何の役」かラベル付け (足場を明示舞台化)`,      confidence: 'medium',    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// OP 9: reify.product (理解/選択/判断のような reifying noun への着地)
// 機構: QUOTATIVE-NOMINAL + (content)? + REIFYING_NOUN の繋がり
//       「〜っていう X」で X が REIFYING_NOUN なら、推論の結果を物として手渡す閉じ。
// ─────────────────────────────────────────────────────────────────────
function op_reify_product(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!isQuotativeNominal(tokens[i])) continue;
    // 直後 1〜3 token 以内に REIFYING_NOUN or content を探す
    for (let j = i + 1; j < Math.min(i + 4, tokens.length); j++) {
      if (hasRole(tokens[j], ROLES.REIFYING_NOUNS)) {
        const evidence = [];
        for (let k = i; k <= j; k++) evidence.push(k);
        out.push({
          opId: 'reify.product',
          family: 'reify',
          span: spanOfTokens(tokens, evidence),
          evidenceTokenIds: evidence,
          mechanism_ja: `QUOTATIVE-NOMINAL + REIFYING-NOUN (${tokens[j].surface}) — 推論結果を名詞化して "物" として手渡す閉じ`,
          confidence: 'high',
        });
        break;
      }
      // content も許容 (将来 reifying-noun が辞書に増えるまでの fallback として弱い instance)
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// OP 10: self.objectify (自己の客体化)
// 機構: FIRST_PERSON + (の)? + content + を + FIRST_PERSON + (が|自身)?
//       一人称が一人称を扱う subject/object split。
// ─────────────────────────────────────────────────────────────────────
function op_self_objectify(tokens) {
  const out = [];
  const fpIds = tokens.map((t, i) => hasRole(t, ROLES.FIRST_PERSON) ? i : -1).filter(i => i >= 0);
  for (let a = 0; a < fpIds.length - 1; a++) {
    const i1 = fpIds[a];
    // 後続 6 token 以内に を を探し、その後にもう一つ FP
    for (let j = i1 + 1; j < Math.min(i1 + 8, tokens.length); j++) {
      if (tokens[j].kind !== 'morph' || tokens[j].surface !== 'を') continue;
      // を の直後 2 token 以内に別の FP
      for (let k = j + 1; k < Math.min(j + 4, tokens.length); k++) {
        if (hasRole(tokens[k], ROLES.FIRST_PERSON) && tokens[k].start !== tokens[i1].start) {
          const evidence = [];
          for (let m = i1; m <= k; m++) evidence.push(m);
          out.push({
            opId: 'self.objectify',
            family: 'self',
            span: spanOfTokens(tokens, evidence),
            evidenceTokenIds: evidence,
            mechanism_ja: '一人称 + (内容語) + を + 一人称 — subject/object 双方が同一一人称指示で split, 自己を客体化する操作',
            intensity: 'high',
            confidence: 'medium',
          });
          a++; // skip
          break;
        }
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// OP 11: evaluator.summon
// 機構: 内容語 (script=katakana, length>=2) + は + 数 token 以内に BELIEF_VERB or judgemental
//       + (EPISTEMIC-MUSE | EPISTEMIC-CONJEC) ending. NER 不要、書字種で proper-name 推定。
// ─────────────────────────────────────────────────────────────────────
function op_evaluator_summon(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 2; i++) {
    const t = tokens[i];
    if (!isContent(t)) continue;
    if (t.script !== 'katakana' || t.surface.length < 2) continue;
    if (!(tokens[i + 1] && tokens[i + 1].surface === 'は')) continue;
    // 後続 12 token 以内に belief verb と epistemic-muse の両方
    let bvId = -1, emId = -1;
    for (let j = i + 2; j < Math.min(i + 16, tokens.length); j++) {
      if (bvId < 0 && hasRole(tokens[j], ROLES.BELIEF_VERBS)) bvId = j;
      if (emId < 0 && tokens[j].kind === 'morph'
          && (tokens[j].role === 'EPISTEMIC-MUSE' || tokens[j].role === 'EPISTEMIC-CONJEC')) emId = j;
    }
    // EPISTEMIC-MUSE/CONJEC は必須 (仮想審判の核)。
    // BELIEF/COGNITION verb は強い証拠だが、辞書に無い content verb の場合があるので任意化。
    if (emId < 0) continue;
    const evidence = [i, i + 1, emId];
    if (bvId >= 0) evidence.push(bvId);
    out.push({
      opId: 'evaluator.summon',
      family: 'voice',
      span: spanOfTokens(tokens, evidence),
      evidenceTokenIds: evidence.slice().sort((a, b) => a - b),
      mechanism_ja: bvId >= 0
        ? '書字種=katakana の内容語 (proper-name 推定) + は + BELIEF/COGNITION + EPISTEMIC-MUSE — 名指しされた評者の視点を借りる仮想審判'
        : '書字種=katakana の内容語 (proper-name 推定) + は + 〜EPISTEMIC-MUSE — 名指しされた者を主語に立て自己に問いかける形 (評者召喚の最小骨格)',
      intensity: 'high',
      confidence: bvId >= 0 ? 'high' : 'medium',
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// OP 12: tag.confirm  (聴き手 (実在/想像) への確認 tag)
// 機構: TAG_CONFIRMATION role の token を 1 個ずつ instance 化。
// ─────────────────────────────────────────────────────────────────────
function op_tag_confirm(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!hasRole(tokens[i], ROLES.TAG_CONFIRMATION)) continue;
    out.push({
      opId: 'tag.confirm',
      family: 'voice',
      span: spanOfTokens(tokens, [i]),
      evidenceTokenIds: [i],
      mechanism_ja: 'TAG_CONFIRMATION 助詞 — 直前命題を「聴き手 (実在/想像) に承認求め」枠で閉じる',
      sub: tokens[i].role,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// OP 13: enum.commit  (前方コミット列挙 — 説明談話の背骨)
// 機構 (二相):
//   (a) commit-open: ENUM-COUNT (二つ/三つ/三点) が後続 ≤4 token 以内に
//       が/は/の を伴う — 「これから N 個 述べる」という前方コミットを開く。
//       後続の文で discharge される forward-reference の起点 (flow が連結)。
//   (b) ordinal-slot: ENUM-ORDINAL (まず/一つ目/次に/最後に) 各 1 個が
//       コミットの 1 slot を埋める discharge マーカー。序数を best-effort 推定。
// これは「context is meaning / 思考間の emergent connection」の予告→回収 tension の
// 形態素的足場。operations は文スコープなので open と slot の連結は flow 層が担う。
// ─────────────────────────────────────────────────────────────────────
const ORDINAL_INDEX = new Map([
  ['まず', 1], ['最初に', 1], ['最初は', 1], ['一つ目', 1], ['第一', 1],
  ['二つ目', 2], ['第二', 2],
  ['三つ目', 3], ['第三', 3],
  ['四つ目', 4], ['五つ目', 5],
  // 相対序数 (絶対値不定)
  ['次に', null], ['続いて', null],
  // 終端
  ['最後に', -1], ['最後は', -1],
]);
const COUNT_VALUE = new Map([
  ['二つ', 2], ['三つ', 3], ['四つ', 4], ['五つ', 5], ['六つ', 6],
  ['二点', 2], ['三点', 3], ['四点', 4],
]);

function op_enum_commit(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // (a) commit-open
    if (hasRole(t, ROLES.ENUM_COUNTS)) {
      // 後続 ≤4 token に格/係/属助詞 (が/は/の/を) があれば「数の宣言」確定。
      // 属格 の の場合はその直後の内容語=被計数名詞 (三つ の 理由 → 理由) まで
      // span を伸ばし、「数」をその対象に束縛する。
      let bind = -1, bindSurf = '';
      for (let j = i + 1; j < Math.min(i + 5, tokens.length); j++) {
        if (tokens[j].kind === 'morph' && /^(が|は|の|を)$/.test(tokens[j].surface)) {
          bind = j; bindSurf = tokens[j].surface; break;
        }
        if (isContent(tokens[j])) continue; // 「三つ の 理由」: 理由(content)を跨ぐ
      }
      // 被計数名詞 (head) を探す。優先順位:
      //   (i)  attributive 「三つ の 理由」 → 属格 の の直後の内容語 (最も直接的)
      //   (ii) topic-comment「理由 は 三つ」 → 後方の は/が 被題名詞
      //   (iii) bare         「三つ 理由」    → count 直後の内容語
      //   指示詞(これ/それ等)は被計数名詞ではないので head から除外。
      const isDeicticOrBad = (tk) => /^(これ|それ|あれ|どれ|ここ|そこ|あそこ|こちら|そちら)$/.test(tk.surface);
      let head = -1;
      // (i) 属格 の の直後 (最優先)
      if (bind >= 0 && bindSurf === 'の') {
        for (let j = bind + 1; j < Math.min(bind + 3, tokens.length); j++) {
          if (isContent(tokens[j])) { head = j; break; }
          if (tokens[j].kind === 'morph') break;
        }
      }
      // (ii) 後方 topic 探索: i-1..i-4 に は/が があり、その手前が(非指示詞)内容語
      if (head < 0) {
        for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
          if (tokens[j].kind === 'morph' && /^(は|が)$/.test(tokens[j].surface)) {
            for (let k = j - 1; k >= Math.max(0, j - 2); k--) {
              if (isContent(tokens[k]) && !isDeicticOrBad(tokens[k])) { head = k; break; }
              if (tokens[k].kind === 'morph') break;
            }
            break;
          }
        }
      }
      // (iii) bare: count 直後の内容語
      if (head < 0) {
        for (let j = i + 1; j < Math.min(i + 3, tokens.length); j++) {
          if (isContent(tokens[j])) { head = j; break; }
        }
      }
      const evidence = [i];
      if (bind >= 0) evidence.push(bind);
      if (head >= 0 && !evidence.includes(head)) evidence.push(head);
      evidence.sort((a, b) => a - b);
      const headSurf = head >= 0 ? tokens[head].surface : null;
      out.push({
        opId: 'enum.commit-open',
        family: 'enum',
        span: spanOfTokens(tokens, [evidence[0], evidence[evidence.length - 1]]),
        evidenceTokenIds: evidence,
        mechanism_ja: headSurf
          ? `ENUM-COUNT 「${t.surface}」+ 被計数名詞 「${headSurf}」 — これから ${COUNT_VALUE.get(t.surface) ?? '?'} 個の「${headSurf}」を述べる前方コミットを開く (後続文で discharge 予定)`
          : `ENUM-COUNT 「${t.surface}」 — これから ${COUNT_VALUE.get(t.surface) ?? '?'} 個述べる前方コミットを開く (後続文で discharge 予定)`,
        committedCount: COUNT_VALUE.get(t.surface) ?? null,
        committedHead: headSurf,
        confidence: bind >= 0 ? 'high' : 'medium',
      });
      continue;
    }
    // (b) ordinal-slot
    if (hasRole(t, ROLES.ENUM_ORDINALS)) {
      const idx = ORDINAL_INDEX.has(t.surface) ? ORDINAL_INDEX.get(t.surface) : null;
      out.push({
        opId: 'enum.ordinal',
        family: 'enum',
        span: spanOfTokens(tokens, [i]),
        evidenceTokenIds: [i],
        mechanism_ja: idx === -1
          ? `ENUM-ORDINAL 「${t.surface}」 — 列挙系列の最終 slot を閉じる`
          : idx === null
            ? `ENUM-ORDINAL 「${t.surface}」 — 列挙系列の次 slot を開く (相対序数)`
            : `ENUM-ORDINAL 「${t.surface}」 — 列挙 slot 序数=${idx} を discharge`,
        ordinal: idx,
        sub: idx === -1 ? 'terminal' : idx === null ? 'relative' : 'absolute',
        confidence: 'high',
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// 全 operation registry
// ─────────────────────────────────────────────────────────────────────
export const OPERATIONS = [
  { id: 'frame.open',           family: 'frame',    color: '#fc6', label: '解釈枠開示',          detect: op_frame_open },
  { id: 'enum.cycle',           family: 'enum',     color: '#bfc', label: '列挙の cycling',      detect: op_enum_cycle },
  { id: 'np.multi-instance',    family: 'np',       color: '#fa8', label: 'NP=実例セット',       detect: op_np_multi_instance },
  { id: 'wrap.quote-nominal',   family: 'wrap',     color: '#cde', label: '引用名詞句で括り',    detect: op_wrap },
  { id: 'recall.categorize',    family: 'recall',   color: '#c9f', label: '回想 → 種類話題化',   detect: op_recall_categorize },
  { id: 'hedge',                family: 'hedge',    color: '#9ab', label: '確信度緩和',          detect: op_hedge },
  { id: 'voice.subjective-marker', family: 'voice', color: '#f8a', label: '主観副詞 marker',     detect: null }, // op_voice_shift が副産物として産出
  { id: 'voice.conclusive-eval',   family: 'voice', color: '#fa8', label: '結論的評価 ending',   detect: null }, // op_voice_shift が副産物として産出
  { id: 'voice.shift-cluster',  family: 'voice',    color: '#f9b', label: '声源 cluster',        detect: op_voice_shift },
  { id: 'argument.typing',      family: 'argument', color: '#fc8', label: '推論役 typing',       detect: op_argument_typing },
  { id: 'reify.product',        family: 'reify',    color: '#fed', label: '推論成果の物化',      detect: op_reify_product },
  { id: 'self.objectify',       family: 'self',     color: '#fcd', label: '自己の客体化',        detect: op_self_objectify },
  { id: 'evaluator.summon',     family: 'voice',    color: '#f9f', label: '評者召喚',            detect: op_evaluator_summon },
  { id: 'tag.confirm',          family: 'voice',    color: '#9cf', label: '確認 tag',            detect: op_tag_confirm },
  { id: 'enum.commit-open',     family: 'enum',     color: '#8df', label: '列挙の前方コミット',  detect: op_enum_commit },
  { id: 'enum.ordinal',         family: 'enum',     color: '#6cf', label: '列挙 slot 順序標識',  detect: null }, // op_enum_commit が副産物として産出
];

/**
 * 文に全 operation を適用。span は必ず token 境界に整列。
 * @returns {{ tokens, instances, overlapByChar, hotspots, totalOps, totalInstances }}
 */
export function analyzeOperations(text) {
  const tokens = tokenize(text);
  const instances = [];
  for (const op of OPERATIONS) {
    if (!op.detect) continue; // metadata-only entry (副産物 op id 用)
    const ins = op.detect(tokens, { text }) || [];
    for (const i of ins) {
      i._opDef = { id: op.id, family: op.family, color: op.color, label: op.label };
    }
    instances.push(...ins);
  }
  // 重なり map
  const overlapByChar = new Array(text.length).fill(0);
  for (const i of instances) {
    for (let k = i.span.start; k < i.span.end; k++) overlapByChar[k]++;
  }
  // hotspot ≥3 重畳
  const hotspots = [];
  let cur = null;
  for (let k = 0; k < overlapByChar.length; k++) {
    if (overlapByChar[k] >= 3) {
      if (!cur) cur = { start: k, end: k + 1, peak: overlapByChar[k] };
      else { cur.end = k + 1; cur.peak = Math.max(cur.peak, overlapByChar[k]); }
    } else if (cur) { hotspots.push(cur); cur = null; }
  }
  if (cur) hotspots.push(cur);
  for (const h of hotspots) h.surface = text.slice(h.start, h.end);
  // accuracy invariants
  for (const inst of instances) {
    // span は token 境界に整列していること
    const startOk = tokens.some(t => t.start === inst.span.start);
    const endOk   = tokens.some(t => t.end === inst.span.end);
    inst._invariants = {
      spanAlignedToTokens: startOk && endOk,
      noMidCharCut: true, // char offset を直接使うので構造的に保証される
    };
    // 信頼度: detector が明示しなければ単一機能語マーカー由来とみなし high。
    // ('fallback' は使わない — operation は「検出した根拠」を必ず持つため、
    //  未検出は instance ではなく coverage 側の unknown で表現する。)
    if (!inst.confidence) inst.confidence = 'high';
  }
  // 信頼度ヒストグラム
  const confidenceCounts = { high: 0, medium: 0, low: 0 };
  for (const inst of instances) confidenceCounts[inst.confidence] = (confidenceCounts[inst.confidence] || 0) + 1;

  // coverage / unknown: 内容語 token のうち、いずれかの operation span に
  // 触れられた割合。内容語が多いのに coverage が低い文 = 「語は見えたが
  // 操作を当てられなかった」= operation 層の未知シグナル。
  // 分母は「内容を担う script」(漢字/カタカナ/数字/mixed) に限る。純ひらがなの
  // content 断片(です/あ/る 等の文法・送り仮名残渣)は内容語ではないので除外し、
  // 指標を意味的に保つ(isContent 自体は変えず coverage の判定だけ絞る)。
  const isContentBearing = t => t.kind === 'content' && t.script !== 'hiragana';
  const contentTokens = tokens.filter(isContentBearing);
  let engagedContent = 0;
  const unknownContent = [];
  for (const t of contentTokens) {
    let covered = false;
    for (let k = t.start; k < t.end; k++) { if (overlapByChar[k] > 0) { covered = true; break; } }
    if (covered) engagedContent++;
    else unknownContent.push({ start: t.start, end: t.end, surface: t.surface, script: t.script });
  }
  const coverage = {
    contentTokens: contentTokens.length,
    engagedContent,
    unknownContent: contentTokens.length - engagedContent,
    coverageRatio: contentTokens.length ? Number((engagedContent / contentTokens.length).toFixed(3)) : 1,
    unknownContentTokens: unknownContent,
  };

  return {
    tokens, instances, overlapByChar, hotspots,
    totalOps: new Set(instances.map(i => i.opId)).size,
    totalInstances: instances.length,
    confidenceCounts,
    coverage,
  };
}
