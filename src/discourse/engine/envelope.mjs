// _tmp_pipeline/envelope.mjs
// L7.6: 包み層 — base unit を polysemy lattice で sense 解決し、
// 文末スタック(tail) / 句中(midClause) を合成して話者スタンスを構成する。
//
// 設計原理(_tmp_polysemy_catalog.md より):
//   - 1 unit = 1 sense ではない。コンテキストで複数 sense のうちどれかが活性化する。
//   - 旧 δ 表(`ね→+共有確認`)は禁止。観察と矛盾する。
//   - 各 sense は activate(ctx) 述語を持ち、最も特定的にマッチしたものを選ぶ。
//   - 文末スタック (例: んですよね) は合成順序敏感に重ね合わせる。
//
// 公開: envelopeSentence(sentence), envelopeDocument(sentences)

const PUNCT_END = /[。．！？]/;
const COMMA = /[、，]/;

// --- 各 base unit の sense lattice ---------------------------------
// 各 sense:
//   id: 安定 ID
//   label: 日本語のラベル
//   tags: { politeness, epistemic, interpersonal, discourse } から非空のものを束ねる
//   activate(ctx): boolean - 活性化条件
//   specificity: 整数 - 同時に複数 activate した時、大きいものが勝つ

const LATTICE = {

  // ============ ね ============ (実コーパス 450 例から)
  'ね': [
    // 文末 ですね/ますね 系
    { id: 'ne-receipt',           label: '同意・受領',                tags: { interpersonal: ['aligning'], discourse: ['receipt'] },
      specificity: 90,
      activate: c => c.atSentEnd && c.turnHead && c.shortSent && /(そう)?です$/.test(c.before) },
    { id: 'ne-soft-judgment',     label: '判定の柔らかい呈示',          tags: { epistemic: ['soft-assert'], interpersonal: ['avoid-imposing'] },
      specificity: 70,
      activate: c => c.atSentEnd && /(です|ます)$/.test(c.before) && !c.shortSent },
    { id: 'ne-self-verbalize',    label: '思考プロセスの音声化',         tags: { epistemic: ['self-monitoring'], discourse: ['self-explain'] },
      specificity: 80,
      activate: c => c.atSentEnd && /んです$/.test(c.before) && !c.afterTurnTakes },
    { id: 'ne-soften-claim',      label: '主張の和らげ',               tags: { epistemic: ['soft-assert'], interpersonal: ['invite-share'] },
      specificity: 60,
      activate: c => c.atSentEnd && /(と思|思います|思うん)/.test(c.before.slice(-8)) },
    // よね/だね/かな ねなど
    { id: 'ne-strong-agreement-elicit', label: '強い同意誘導',            tags: { interpersonal: ['elicit-agreement'], discourse: ['shared-ground'] },
      specificity: 95,
      activate: c => c.atSentEnd && /よ$/.test(c.before) },
    { id: 'ne-flat-confirm',      label: '平叙の柔らかい確認',           tags: { epistemic: ['confirmed'], interpersonal: ['aligning'] },
      specificity: 85,
      activate: c => c.atSentEnd && /(だ|な|なん)$/.test(c.before) && !/です$/.test(c.before) },
    // けどね / からね / ってね / でしょうね
    { id: 'ne-reservation-softener', label: '留保緩和',                tags: { epistemic: ['hedge'], interpersonal: ['back-off'] },
      specificity: 95,
      activate: c => c.atSentEnd && /(けど|けども)$/.test(c.before) },
    { id: 'ne-ground-tag',        label: '根拠を後付け補強',           tags: { discourse: ['ground-tag'], interpersonal: ['justify'] },
      specificity: 95,
      activate: c => c.atSentEnd && /(から)$/.test(c.before) },
    { id: 'ne-quote-trail',       label: '引用を投げっぱなしの溜息',    tags: { discourse: ['quote-trail'], epistemic: ['unresolved'] },
      specificity: 95,
      activate: c => c.atSentEnd && /(って|と)$/.test(c.before) },
    { id: 'ne-joint-conjecture',  label: '共同推量',                   tags: { epistemic: ['joint-conjecture'] },
      specificity: 95,
      activate: c => c.atSentEnd && /(でしょう|だろう|だろ|でしょ)$/.test(c.before) },
    // 疑問+ね
    { id: 'ne-self-probe',        label: '打診/独白問い',              tags: { epistemic: ['self-probe'], interpersonal: ['low-commitment-ask'] },
      specificity: 90,
      activate: c => c.atSentEnd && /(か|かな|かしら)$/.test(c.before) },
    { id: 'ne-soft-interrogation', label: '詰問の柔らかさ',             tags: { interpersonal: ['soft-press'] },
      specificity: 92,
      activate: c => /^[?？]/.test(c.after) },
    // 文頭・句中 呼びかけ前置
    { id: 'ne-discourse-hold',    label: '発話順序ホールド/注意惹起',    tags: { discourse: ['hold-floor', 'invite-attention'] },
      specificity: 100,
      activate: c => c.atClauseEnd && (c.atSentStart || /^(?:あの|その|まあ|でも|それで|あと|ただ|で|だから)$/.test(c.prevWordSmall)) },
    { id: 'ne-condition-hold',    label: '条件提示後のホールド',         tags: { discourse: ['hold-floor'], epistemic: ['build-up'] },
      specificity: 85,
      activate: c => c.atClauseEnd && /(と|たら|ば|なら|ったら)$/.test(c.before) },
    { id: 'ne-continuation-hold', label: '継起・立場限定後のホールド',   tags: { discourse: ['hold-floor', 'narrative-stitch'] },
      specificity: 80,
      activate: c => c.atClauseEnd && /(で|して|くて|として|に|から)$/.test(c.before) },
    // 例示+ね
    { id: 'ne-loose-listing',     label: '緩い列挙',                  tags: { discourse: ['loose-listing'] },
      specificity: 85,
      activate: c => c.atSentEnd && /(とか|など)$/.test(c.before) },
    // 子ども向け命令
    { id: 'ne-gentle-direct',     label: '柔らかい指示',              tags: { interpersonal: ['gentle-directive'] },
      specificity: 75,
      activate: c => c.atSentEnd && /(よう|なさい)$/.test(c.before) },
    // フォールバック
    { id: 'ne-generic',           label: 'ね(一般)',                  tags: { interpersonal: ['involve-hearer'] },
      specificity: 1,
      activate: c => true },
  ],

  // ============ よ ============ (実コーパス 70 真例から)
  'よ': [
    { id: 'yo-notify-finding',    label: '自分の判断・発見の通知',       tags: { epistemic: ['speaker-finding'], interpersonal: ['inform-hearer'] },
      specificity: 80,
      activate: c => c.atSentEnd && /(です|ます|だ|ん|なん|あるん|いるん)$/.test(c.before) },
    { id: 'yo-counter-claim',     label: '反論・対抗・釘さし',          tags: { epistemic: ['counter'], interpersonal: ['push-back'] },
      specificity: 85,
      activate: c => c.atSentEnd && /(ない|なん|るな|くない)$/.test(c.before.slice(-3)) },
    { id: 'yo-feminine-emphasis', label: '詠嘆「のよ」',                tags: { interpersonal: ['intimate'], discourse: ['expressive'] },
      specificity: 90,
      activate: c => c.atSentEnd && /の$/.test(c.before) },
    { id: 'yo-postpose-marker',   label: '倒置強調(後置主題)',          tags: { discourse: ['postpose-marker'] },
      specificity: 95,
      activate: c => c.atClauseEnd && c.hasFollowingNominalShort },
    { id: 'yo-praise-warmth',     label: '親密呼びかけ・賞賛',          tags: { interpersonal: ['warm-praise'] },
      specificity: 70,
      activate: c => c.atSentEnd && c.shortSent && /(いい|よかった|すごい)$/.test(c.before) },
    { id: 'yo-generic',           label: 'よ(一般)',                  tags: { interpersonal: ['inform-hearer'] },
      specificity: 1,
      activate: c => true },
  ],

  // ============ よね ============ (まず よね 単独として扱う)
  'よね': [
    { id: 'yone-elicit-strong',   label: '強い同意誘導',                tags: { interpersonal: ['elicit-agreement'], discourse: ['shared-ground'] },
      specificity: 80,
      activate: c => c.atSentEnd && /(です|ます|だ|ある|いる|ない)$/.test(c.before) },
    { id: 'yone-soft-mine',       label: '言い切り和らげ(自分の意見)',   tags: { epistemic: ['soft-assert'], interpersonal: ['avoid-imposing'] },
      specificity: 90,
      activate: c => c.atSentEnd && /(と思う|思います|思うん)/.test(c.before.slice(-8)) },
    { id: 'yone-topic-wrap',      label: '論点回帰・話題接ぎ',          tags: { discourse: ['topic-wrap'] },
      specificity: 60,
      activate: c => c.atSentEnd },
    { id: 'yone-generic',         label: 'よね(一般)',                tags: { interpersonal: ['elicit-agreement'] },
      specificity: 1, activate: c => true },
  ],

  // ============ って ============ (引用標識として扱う sense 群。動詞て形は false positive として除外)
  // 注: 動詞て形除外は detect 時に行う。
  'って': [
    { id: 'tte-direct-quote',     label: '純粋引用',                  tags: { discourse: ['direct-quote'] },
      specificity: 95,
      activate: c => /^(?:言|思|聞|呼|書|考)/.test(c.after) },
    { id: 'tte-quoted-iu',        label: '引用 + いう(分節化)',         tags: { discourse: ['quoted-iu'] },
      specificity: 90,
      activate: c => /^(?:いう|いっ|ゆう)/.test(c.after) },
    { id: 'tte-definition-open',  label: '定義開き(とは相当)',          tags: { discourse: ['definition-open'] },
      specificity: 92,
      activate: c => /^の(?:は|が|を)/.test(c.after) },
    { id: 'tte-colloquial-topic', label: '口語主題マーカー(は相当)',     tags: { discourse: ['topic-marker-casual'] },
      specificity: 85,
      activate: c => /^(?:こと|時|話|わけ|もの|人|やつ|ふう|風)/.test(c.after) },
    { id: 'tte-thought-toss',     label: '末尾投出(思考の振り出し)',    tags: { discourse: ['thought-toss'], epistemic: ['unresolved'] },
      specificity: 88,
      activate: c => c.atSentEnd && !c.afterTurnTakes },
    { id: 'tte-listen-reanchor',  label: '末尾 reanchor(過去発話)',     tags: { discourse: ['listen-reanchor'] },
      specificity: 80,
      activate: c => c.atSentEnd && /(聞いた|言った|思った)/.test(c.before.slice(-6)) },
    { id: 'tte-quote-generic',    label: '引用(一般)',                tags: { discourse: ['quote'] },
      specificity: 1, activate: c => true },
  ],

  // ============ けど ============ (実コーパス 145 例)
  'けど': [
    { id: 'kedo-contrast-true',   label: '真の逆接',                   tags: { discourse: ['contrast'], epistemic: ['concede-then-claim'] },
      specificity: 90,
      activate: c => c.atClauseEnd && c.hasFollowingMainClause },
    { id: 'kedo-concession-prep', label: '譲歩前置',                   tags: { discourse: ['concession-prep'] },
      specificity: 70,
      activate: c => c.atClauseEnd },
    { id: 'kedo-trail-off',       label: '言いさし(関係性配慮)',        tags: { interpersonal: ['avoid-conclusion'], discourse: ['trail-off'] },
      specificity: 80,
      activate: c => c.atSentEnd && !/[?？]/.test(c.after) },
    { id: 'kedo-tentative-probe', label: '婉曲な反論・含み持たせ',      tags: { interpersonal: ['veiled-objection'] },
      specificity: 90,
      activate: c => c.atSentEnd && /^[?？]/.test(c.after) },
    { id: 'kedo-with-ne',         label: '留保緩和 (けどね)',           tags: { interpersonal: ['back-off'] },
      specificity: 95,
      activate: c => /^ね/.test(c.after) && (c.afterEndsAtPunct) },
    { id: 'kedo-generic',         label: 'けど(一般)',                tags: { discourse: ['contrast'] },
      specificity: 1, activate: c => true },
  ],

  // ============ んです ============ (実コーパス 176 例)
  'んです': [
    { id: 'ndesu-explain-flat',   label: '背景説明断定',                tags: { politeness: ['desu-masu'], discourse: ['background-explanation'] },
      specificity: 80,
      activate: c => c.atSentEnd && !/(よ|ね|か|よね)/.test(c.after) },
    { id: 'ndesu-implicate',      label: '含意誘発',                  tags: { politeness: ['desu-masu'], discourse: ['background-explanation', 'implicate'] },
      specificity: 90,
      activate: c => /^よ(?![ね])/.test(c.after) && c.afterEndsAtPunct },
    { id: 'ndesu-share-explain',  label: '共有確認込みの背景説明',       tags: { politeness: ['desu-masu'], interpersonal: ['elicit-agreement'] },
      specificity: 95,
      activate: c => /^(よね|ね)/.test(c.after) && c.afterEndsAtPunct },
    { id: 'ndesu-cushion',        label: 'クッション(本題前置)',         tags: { politeness: ['desu-masu'], discourse: ['cushion'] },
      specificity: 95,
      activate: c => /^けど/.test(c.after) },
    { id: 'ndesu-ground-prep',    label: '根拠提示前置',                tags: { politeness: ['desu-masu'], discourse: ['ground-prep'] },
      specificity: 95,
      activate: c => /^から/.test(c.after) },
    { id: 'ndesu-question-soft',  label: '反問・確認',                tags: { politeness: ['desu-masu'], interpersonal: ['soft-question'] },
      specificity: 95,
      activate: c => /^か/.test(c.after) },
    { id: 'ndesu-generic',        label: 'んです(一般)',                tags: { politeness: ['desu-masu'], discourse: ['background-explanation'] },
      specificity: 1, activate: c => true },
  ],

  // ============ みたい ============ (52例)
  'みたい': [
    { id: 'mitai-quoted-impression', label: '印象引用(みたいな)',          tags: { discourse: ['impression-quote'] },
      specificity: 90,
      activate: c => /^な/.test(c.after) && !/^な(?:い|か)/.test(c.after) },
    { id: 'mitai-analogy',        label: '比喩・類似',                tags: { discourse: ['analogy'] },
      specificity: 80,
      activate: c => /^(?:に|で|だ|です)/.test(c.after) },
    { id: 'mitai-conjecture',     label: '推量・伝聞',                tags: { epistemic: ['hearsay-conjecture'] },
      specificity: 70,
      activate: c => c.atSentEnd || /^[。、，]/.test(c.after) },
    { id: 'mitai-generic',        label: 'みたい(一般)',               tags: { discourse: ['approximation'] },
      specificity: 1, activate: c => true },
  ],

  // ============ なんか ============ (43例 — 副詞的フィラー)
  'なんか': [
    { id: 'nanka-hedge-filler',   label: '曖昧化フィラー',              tags: { epistemic: ['hedge'], discourse: ['filler'] },
      specificity: 70,
      activate: c => !c.atSentStart && c.midClause },
    { id: 'nanka-downplay',       label: '含み持たせ・downplay',        tags: { epistemic: ['downplay'] },
      specificity: 80,
      activate: c => /^(?:みたい|っぽい|っていう|的な)/.test(c.after) },
    { id: 'nanka-generic',        label: 'なんか(一般)',                tags: { epistemic: ['hedge'] },
      specificity: 1, activate: c => true },
  ],

  // ============ まあ ============ (30例)
  'まあ': [
    { id: 'maa-concede',          label: '譲歩・部分承認',             tags: { discourse: ['concede'] },
      specificity: 70,
      activate: c => c.atSentStart },
    { id: 'maa-soften',           label: '緩和・遠回し',               tags: { interpersonal: ['soften'] },
      specificity: 60,
      activate: c => c.midClause },
    { id: 'maa-generic',          label: 'まあ(一般)',                tags: { discourse: ['soften-discourse'] },
      specificity: 1, activate: c => true },
  ],

  // ============ やっぱ / やっぱり ============ (28+16例)
  'やっぱ': [
    { id: 'yappa-as-expected',    label: '想定通りの確認',             tags: { epistemic: ['as-expected'], discourse: ['return-to-conclusion'] },
      specificity: 70,
      activate: c => true },
  ],
  'やっぱり': [
    { id: 'yappari-as-expected',  label: '想定通りの確認',             tags: { epistemic: ['as-expected'], discourse: ['return-to-conclusion'] },
      specificity: 70,
      activate: c => true },
  ],

  // ============ ちょっと ============ (38例)
  'ちょっと': [
    { id: 'chotto-soften',        label: '婉曲遠回し',                 tags: { interpersonal: ['soften'] },
      specificity: 80,
      activate: c => /^(?:そう|無理|難|微妙|違|どう|キャリア|心配)/.test(c.after) || c.atSentEnd },
    { id: 'chotto-topic-open',    label: '話題開始軟化',               tags: { discourse: ['topic-open-soft'] },
      specificity: 70,
      activate: c => c.atSentStart },
    { id: 'chotto-small-quantity', label: '量的少量',                  tags: { epistemic: ['quantitative-small'] },
      specificity: 60,
      activate: c => true },
  ],

  // ============ もう ============ (53例)
  'もう': [
    { id: 'mou-completion',       label: '完了・既然',                tags: { epistemic: ['completion'] },
      specificity: 80,
      activate: c => /^(?:[一-龥]+|終わ|やめ|終)/.test(c.after) && !c.atSentStart },
    { id: 'mou-intensify',        label: '強調・極限',                tags: { epistemic: ['intensify'] },
      specificity: 70,
      activate: c => /^(?:べちゃ|本当|ホント|ぐちゃ|めちゃ|やっぱ|やはり)/.test(c.after) },
    { id: 'mou-discourse-marker', label: '語気強め・諦め',             tags: { interpersonal: ['exasperation'] },
      specificity: 60,
      activate: c => c.atSentStart },
    { id: 'mou-generic',          label: 'もう(一般)',                tags: { epistemic: ['completion'] },
      specificity: 1, activate: c => true },
  ],

  // ============ かな ============ (43例)
  'かな': [
    { id: 'kana-self-question',   label: '自問・独白問い',             tags: { epistemic: ['self-probe'], discourse: ['inner-question'] },
      specificity: 80,
      activate: c => c.atSentEnd && !c.afterTurnTakes },
    { id: 'kana-low-commitment-probe', label: '相手への打診',           tags: { interpersonal: ['low-commitment-ask'] },
      specificity: 75,
      activate: c => c.atSentEnd },
    { id: 'kana-generic',         label: 'かな(一般)',                tags: { epistemic: ['self-probe'] },
      specificity: 1, activate: c => true },
  ],
};

// --- 動詞て形の false positive 除外 (って) -------------------
// 直前形態素が動詞活用形 (なっ/っ/い/し etc.) で、直後が動詞 (じゃない/する/いる/くる) なら て形と判定。
const VERBAL_BEFORE = /(なっ|っ|い|し|来|き|去|来ちゃっ|わかっ|思っ|言っ|やっ|行っ|帰っ|終わっ|変わっ|考え|思|言|聞|呼|考|書|歌|流|入|出|乗|寝|起|笑|泣|消|教|読|見|知|残|出ちゃっ|なくなっ|あっ|なくっ|多くなっ)$/;
function isVerbalTeForm(before, after) {
  if (!VERBAL_BEFORE.test(before)) return false;
  // 引用評語動詞が後続:
  //   - 直前が「と」なら本物の引用 (例: 「Xと言って」) → false (=除外しない、引用として残す)
  //   - 直前が動詞 (例: 「思って言う」) なら動詞 て形 連結 → true (=除外)
  if (/^(?:言|思|聞|呼|考|書|いう|いっ|思っ|言っ|聞い)/.test(after)) {
    if (/と$/.test(before)) return false;
    return true;
  }
  // 後続が「いる/くる/しまう/いく/ある/おく/みる/もらう/くれる/あげる」など補助動詞
  return /^(?:い|る|ま|く|こ|い[くこ]|もら|くれ|あげ|み|お|あ)/.test(after);
}

// --- 出現を全件抽出 ------------------------------
function findOccurrences(text) {
  const out = [];
  for (const unit of Object.keys(LATTICE)) {
    let i = 0;
    while ((i = text.indexOf(unit, i)) !== -1) {
      const before = text.slice(0, i);
      const after = text.slice(i + unit.length);
      // って の false positive ガード
      if (unit === 'って' && isVerbalTeForm(before, after)) { i += unit.length; continue; }
      out.push({ unit, offset: i, length: unit.length, before, after });
      i += unit.length;
    }
  }
  // よね を ね と二重抽出すると干渉するので、よね の範囲に含まれる ね を取り除く
  const yoneRanges = out.filter(o => o.unit === 'よね').map(o => [o.offset, o.offset + o.length]);
  return out.filter(o => {
    if (o.unit !== 'ね' && o.unit !== 'よ') return true;
    return !yoneRanges.some(([s, e]) => o.offset >= s && o.offset < e);
  }).sort((a, b) => a.offset - b.offset);
}

// --- 文脈オブジェクト構築 ----------------------------
function buildCtx(text, occ, sentenceMeta) {
  const { before, after, offset, length } = occ;
  const tail = text.slice(offset + length);
  // 末尾候補助詞を順次剥いで atSentEnd 判定: 「けど」+「ね」+「。」も末尾扱い
  const TAIL_STRIP = /^(んです|よね|です|ます|ね|よ|か|さ|わ|な|の|から|けど|けども|かな|でしょう|でしょ|だろう|だろ)/;
  let stripped = tail;
  let guard = 0;
  while (stripped && guard++ < 6) {
    const m = stripped.match(TAIL_STRIP);
    if (!m) break;
    stripped = stripped.slice(m[0].length);
  }
  const atSentEnd = stripped.length === 0 || PUNCT_END.test(stripped[0]);
  const atClauseEnd = !atSentEnd && COMMA.test(tail[0]);
  const atSentStart = before.replace(/[、，\s]/g, '').length === 0;
  const afterEndsAtPunct = PUNCT_END.test(after) || atSentEnd;
  // 直前小単位語(あの/その/ま/まあ/でも/それで/ただ/で/だから 等)
  const wordSmall = before.replace(/[、，\s]/g, '').slice(-3);
  return {
    before, after, offset,
    atSentEnd, atClauseEnd, atSentStart, afterEndsAtPunct,
    midClause: !atSentEnd && !atSentStart,
    shortSent: text.length <= 10,
    prevWordSmall: wordSmall,
    // 倒置の予兆: , の直後に短い NP のみがある
    hasFollowingNominalShort: /^[、，]\s*[^。．！？]{1,12}[。．！？]?$/.test(tail),
    // 後続に主節がある (けど の真逆接判定用)
    hasFollowingMainClause: /[、，][^。．！？]{4,}/.test(tail),
    // ターン頭フラグ (sentenceMeta が与えれば)
    turnHead: sentenceMeta?.turnHead === true,
    afterTurnTakes: sentenceMeta?.afterTurnTakes === true,
  };
}

// --- sense 解決 ---------------------------------
function resolveSense(unit, ctx) {
  const senses = LATTICE[unit] || [];
  let best = null;
  let bestSpec = -1;
  const candidates = [];
  for (const s of senses) {
    try {
      if (s.activate(ctx)) {
        candidates.push(s);
        if (s.specificity > bestSpec) { best = s; bestSpec = s.specificity; }
      }
    } catch (_) { /* activate がエラーなら無視 */ }
  }
  return { sense: best, candidates: candidates.map(s => s.id) };
}

// --- 文の envelope を作る -----------------------------
export function envelopeSentence(sentence, sentenceMeta = {}) {
  const text = (typeof sentence === 'string' ? sentence : (sentence?.text || ''));
  const occs = findOccurrences(text);
  const resolved = occs.map(o => {
    const ctx = buildCtx(text, o, sentenceMeta);
    const { sense, candidates } = resolveSense(o.unit, ctx);
    return { ...o, sense, candidates, atSentEnd: ctx.atSentEnd, atClauseEnd: ctx.atClauseEnd };
  });

  // 文末スタック: 文末助詞の連鎖を末尾から拾う
  // (例: んです + よ + ね は 3 つの occ として並ぶ)
  const tail = [];
  // 末尾位置 = text の最後の句点を超えた直前まで
  const lastTerm = text.search(/[。．！？]\s*$/);
  const endAt = lastTerm >= 0 ? lastTerm : text.length;
  // resolved を offset 昇順に並べ、末尾 (end == endAt) から逆向きに「隣接連鎖」する occ を集める
  const ordered = [...resolved].sort((a, b) => a.offset - b.offset);
  let cursor = endAt;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const r = ordered[i];
    if (r.offset + r.length === cursor) {
      tail.unshift(r);
      cursor = r.offset;
    } else if (r.offset + r.length < cursor) {
      // 隣接が途切れたら停止
      break;
    }
    // r.end > cursor (= 既に拾った範囲とオーバーラップ) は無視
  }

  // 句中: ね、 / けど、 / が、 など (atClauseEnd)
  const midClause = resolved.filter(r => r.atClauseEnd);

  // --- 合成 stance ---------------------------------
  const stance = composeStance(tail, midClause, resolved);

  return { occurrences: resolved, tail, midClause, stance };
}

// --- 合成則: tail の sense を順序敏感に重ね合わせる ------------
function composeStance(tail, midClause, allOccs) {
  const out = {
    politeness: new Set(),
    epistemic: new Set(),
    interpersonal: new Set(),
    discourse: new Set(),
    note: [],
  };

  function add(tags) {
    for (const k of ['politeness', 'epistemic', 'interpersonal', 'discourse']) {
      const arr = tags?.[k];
      if (Array.isArray(arr)) for (const t of arr) out[k].add(t);
    }
  }

  // 各 occ の sense.tags を加算
  for (const o of allOccs) {
    if (o.sense?.tags) add(o.sense.tags);
  }

  // 順序敏感な複合読み (tail を unit 列に整列)
  const tailUnits = tail.map(t => t.unit);
  const tailJoined = tailUnits.join('+');

  // 既知の頻出スタック
  const COMPOSITES = [
    { pattern: ['んです','よ','ね'], note: '背景説明を発見として共有し同意を待つ' },
    { pattern: ['んです','よね'],     note: '背景説明を既知前提として共有する' },
    { pattern: ['んです','よ'],       note: '背景を発見として通知' },
    { pattern: ['んです','けど'],     note: 'クッションを敷いて本題に入る' },
    { pattern: ['んです','から'],     note: '根拠を背景として提示' },
    { pattern: ['んです','か'],       note: '反問の柔らかさ' },
    { pattern: ['んです','ね'],       note: '背景説明の柔らかい確認' },
    { pattern: ['んです'],            note: '背景説明断定' },
    { pattern: ['よ','ね'],           note: '通知+共有確認' },
    { pattern: ['けど','ね'],         note: '留保しつつ共有' },
    { pattern: ['から','ね'],         note: '根拠を後付けで添える' },
  ];

  for (const c of COMPOSITES) {
    if (matchTail(tailUnits, c.pattern)) { out.note.push(c.note); break; }
  }

  return {
    politeness: [...out.politeness],
    epistemic: [...out.epistemic],
    interpersonal: [...out.interpersonal],
    discourse: [...out.discourse],
    composition: out.note,
    tailSurface: tailUnits.join('+') || null,
  };
}

function matchTail(tailUnits, pattern) {
  if (tailUnits.length < pattern.length) return false;
  const slice = tailUnits.slice(-pattern.length);
  for (let i = 0; i < pattern.length; i++) {
    if (slice[i] !== pattern[i]) return false;
  }
  return true;
}

// --- 文書全体に貼る ---------------------------------
export function envelopeDocument(sentences) {
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const prev = sentences[i - 1];
    const meta = {
      turnHead: prev ? (prev.turnIdx !== s.turnIdx) : true,
      afterTurnTakes: false,
    };
    s.envelope = envelopeSentence(s, meta);
  }
  return sentences;
}

// --- 公開: lattice メタデータ (テスト/dashboard 用) ----------
export function listUnits() { return Object.keys(LATTICE); }
export function listSenses(unit) { return (LATTICE[unit] || []).map(s => ({ id: s.id, label: s.label, tags: s.tags })); }
