// _tmp_pipeline/lexicon.mjs
// =====================================================================
// JAPANESE DISCOURSE-GRAMMAR OPERATOR LEXICON
// ---------------------------------------------------------------------
// Each operator is a *cognitive maneuver* on common ground, not a part
// of speech tag. Triggers are skeleton-level surface patterns; the real
// operator only fires when the surrounding configuration (position in
// sentence, presence/absence of antecedent, following content) matches.
//
// Schema:
//   id              — stable identifier, SCREAMING-KEBAB-CASE
//   category        — grouping (connective.conditional, modality.epistemic, ...)
//   gloss_ja        — short Japanese label shown in reports
//   gloss_en        — short English label
//   cognitive_effect — what it does to common ground / listener model
//   triggers        — array of pattern matchers (see types below)
//   opens_span      — span label opened (resolved by relations.mjs)
//   closes_span     — span label closed
//   requires_one_of — list of operators/spans that must follow within window
//   composes_with   — operator → composite-id mapping when adjacent
//   priority        — higher wins on ambiguity (default 0)
//
// Trigger types:
//   { surface: 'たら', scope: 'verbal-suffix' }
//   { regex: /から[ねよ]?$/, scope: 'sentence-final' }
//   { surface: 'は', scope: 'particle', not_after: ['で','に','と'] }
//   scope ∈ {
//     'sentence-initial','sentence-final','clause-final','clause-initial',
//     'verbal-suffix','copula-suffix','adj-suffix','particle','anywhere',
//     'after-noun','after-verb','after-clause','standalone'
//   }
// =====================================================================

/** @typedef {{
 *   surface?:string, regex?:RegExp, scope:string,
 *   not_after?:string[], not_before?:string[],
 *   requires_preceding?:string, requires_following?:string
 * }} Trigger */

/** @typedef {{
 *   id:string, category:string, gloss_ja:string, gloss_en:string,
 *   cognitive_effect:string, triggers:Trigger[],
 *   layer?:'g'|'d',
 *   opens_span?:string, closes_span?:string,
 *   requires_one_of?:string[], composes_with?:Record<string,string>,
 *   priority?:number, note?:string,
 *   derived_from?:string[], requires_context?:string[]
 * }} Operator */

// ---------------------------------------------------------------------
// LAYER DISTINCTION (added 2026-05)
//   layer:'g'  GRAMMAR  default. A surface morpheme / lexical pattern
//                       that fires whenever its trigger matches. Reports
//                       a brute fact about the sentence form.
//   layer:'d'  DISCOURSE A cognitive maneuver that is only meaningful
//                       when several grammar facts co-occur with the
//                       right contextual evidence (speaker stance,
//                       addressee state, preceding turn's claim, topic
//                       continuity, 1st-person undergoer, affect lexeme,
//                       etc.). Discourse ops have NO surface triggers;
//                       they are derived in relations.mjs.
//   `derived_from`     list of grammar opIds that must co-occur
//   `requires_context` list of context-evidence tokens (informational)
// ---------------------------------------------------------------------

/** @type {Operator[]} */
export const OPERATORS = [

  // =========================================================
  // 1. CONDITIONAL / HYPOTHETICAL FAMILY
  // =========================================================
  {
    id: 'CONDITIONAL-ANTECEDENT',
    category: 'conditional.antecedent',
    gloss_ja: '条件節',
    gloss_en: 'conditional-antecedent',
    cognitive_effect: '仮想世界を開いて聞き手の評価枠を提供する',
    triggers: [
      { surface: 'たら',   scope: 'verbal-suffix', not_after: ['しまっ','終わっ','行っ','来'] },
      { surface: 'だら',   scope: 'verbal-suffix' },
      { surface: 'れば',   scope: 'verbal-suffix' },
      { surface: 'えば',   scope: 'verbal-suffix' },
      { surface: 'なら',   scope: 'copula-suffix', not_after: ['みん'] },
      { surface: 'ならば', scope: 'copula-suffix' },
      { regex: /と[、，]/, scope: 'clause-final', not_before: ['言','思','考','聞','見'] },
    ],
    opens_span: 'conditional',
    requires_one_of: ['CONSEQUENT','SUSPEND-APODOSIS'],
    composes_with: { 'CLASS-LIFT': 'CATEGORICAL-CONDITIONAL', 'PUTATIVE-ASCRIBE': 'MOTIVE-CONDITIONAL' },
    priority: 5,
  },
  {
    id: 'HYPOTHETICAL-SUPPOSING',
    category: 'conditional.hypothetical',
    gloss_ja: '仮定提示',
    gloss_en: 'hypothetical-supposing',
    cognitive_effect: '仮想を明示的に枠付けして「これは仮定だ」と宣言する',
    triggers: [
      { surface: 'もし',     scope: 'sentence-initial' },
      { surface: '仮に',     scope: 'sentence-initial' },
      { surface: '万が一',   scope: 'sentence-initial' },
    ],
    opens_span: 'conditional',
    priority: 6,
  },
  {
    id: 'CONCESSIVE-CONDITIONAL',
    category: 'conditional.concessive',
    gloss_ja: '譲歩条件',
    gloss_en: 'concessive-conditional',
    cognitive_effect: '反対条件下でも結論を成立させる強い主張枠',
    triggers: [
      { surface: 'たとえ',   scope: 'sentence-initial' },
      { surface: 'いくら',   scope: 'sentence-initial' },
      { surface: 'どんなに', scope: 'sentence-initial' },
    ],
    opens_span: 'conditional-concessive',
  },
  {
    id: 'WORLD-RECALL',
    category: 'conditional.world-recall',
    gloss_ja: '世界呼び戻し',
    gloss_en: 'world-recall',
    cognitive_effect: '前段の仮想世界に時間軸を与えて再起動する',
    triggers: [
      { surface: 'そうなった時', scope: 'anywhere' },
      { surface: 'そうなる時',   scope: 'anywhere' },
      { surface: 'そういう時',   scope: 'anywhere' },
      { surface: 'そうした時',   scope: 'anywhere' },
      { surface: 'そんな時',     scope: 'anywhere' },
      { surface: 'その時に',     scope: 'anywhere' },
      { surface: 'その時',       scope: 'anywhere' },
    ],
    opens_span: 'recalled-world',
    requires_one_of: ['CONSEQUENT','SUSPEND-APODOSIS'],
  },

  // =========================================================
  // 2. CONCESSIVE / ADVERSATIVE FAMILY
  // =========================================================
  {
    id: 'CONCESSIVE-CONTRAST',
    category: 'concessive.contrast',
    gloss_ja: '逆接',
    gloss_en: 'concessive-contrast',
    cognitive_effect: '前提を一旦認めて反対方向へ転じる',
    triggers: [
      { surface: 'けれども', scope: 'clause-final' },
      { surface: 'けれど',   scope: 'clause-final' },
      { surface: 'けども',   scope: 'clause-final' },
      { surface: 'けど',     scope: 'clause-final' },
      { regex: /が[、，]/,   scope: 'clause-final', not_after: ['です','ます','する','ある','いる'], requires_after_predicate: true },
      { surface: 'しかし',   scope: 'sentence-initial' },
      { surface: 'でも',     scope: 'sentence-initial', not_after: ['何','なに','なん','誰','だれ','いつ','どこ','どれ','いくら','どちら','どっち','とん'] },
      { surface: 'ところが', scope: 'sentence-initial' },
      { surface: 'とはいえ', scope: 'sentence-initial' },
    ],
    priority: 4,
  },
  {
    id: 'HEDGE-INCOMPLETE',
    category: 'concessive.hedge',
    gloss_ja: '言い切らない',
    gloss_en: 'hedge-incomplete',
    cognitive_effect: '主張を言い切らず聞き手に判断を委ねる',
    triggers: [
      { surface: 'けど',     scope: 'sentence-final' },
      { surface: 'けれど',   scope: 'sentence-final' },
      { surface: 'けれども', scope: 'sentence-final' },
      { surface: 'んだけど', scope: 'sentence-final' },
      { surface: 'んですけど', scope: 'sentence-final' },
      { surface: 'のですが', scope: 'sentence-final' },
    ],
    priority: 6,
  },
  {
    id: 'CONCESSIVE-STRONG',
    category: 'concessive.strong',
    gloss_ja: '強逆接',
    gloss_en: 'concessive-strong',
    cognitive_effect: '対立を強調して反論優位を確立する',
    triggers: [
      { surface: 'にもかかわらず', scope: 'anywhere' },
      { surface: 'にも関わらず',   scope: 'anywhere' },
      { surface: 'それなのに',     scope: 'sentence-initial' },
      { surface: 'ものの',         scope: 'clause-final' },
    ],
  },
  {
    id: 'CONCESSIVE-SUFFIX',
    category: 'concessive.suffix',
    gloss_ja: '譲歩接続',
    gloss_en: 'concessive-suffix',
    cognitive_effect: '副条件下でも主張を維持する',
    triggers: [
      { surface: 'ても',     scope: 'verbal-suffix', not_after: ['って','し'] },
      { surface: 'でも',     scope: 'verbal-suffix', not_after: ['何','なに','なん','誰','だれ','いつ','どこ','どれ','いくら','どちら','どっち','とん'] },
      { surface: 'たって',   scope: 'verbal-suffix', not_before: ['いう','いっ','言','思','考','聞','見','書','話'] },
      { surface: 'にしても', scope: 'clause-final' },
      { surface: 'にせよ',   scope: 'clause-final' },
      { surface: 'にしろ',   scope: 'clause-final' },
      { surface: 'であっても', scope: 'clause-final' },
    ],
  },

  // =========================================================
  // 3. CAUSAL / INFERENTIAL FAMILY
  // =========================================================
  {
    id: 'CAUSAL-DERIVE',
    category: 'causal.derive',
    gloss_ja: '因果導出',
    gloss_en: 'causal-derive',
    cognitive_effect: '前提から結論を「だから当然」と導く',
    triggers: [
      { surface: 'から',     scope: 'anywhere', not_after: ['だ','です','てある','ている','てい','の','もの','後','それ','これ','あれ','どれ','ここ','そこ','あそこ','どこ'], requires_after_predicate: true },
      { surface: 'からね',   scope: 'sentence-final' },
      { surface: 'からよ',   scope: 'sentence-final' },
      { surface: 'からです', scope: 'sentence-final' },
      { surface: 'からだ',   scope: 'sentence-final' },
      { surface: 'ので',     scope: 'clause-final' },
      { surface: 'のでね',   scope: 'sentence-final' },
      { surface: 'ため',     scope: 'clause-final' },
      { surface: 'ために',   scope: 'clause-final' },
    ],
    priority: 4,
  },
  {
    id: 'CAUSAL-DISCOURSE',
    category: 'causal.discourse',
    gloss_ja: '談話的因果',
    gloss_en: 'causal-discourse',
    cognitive_effect: '文を跨いで前文を根拠化する',
    triggers: [
      { surface: 'だから',   scope: 'sentence-initial' },
      { surface: 'そのため', scope: 'sentence-initial' },
      { surface: 'そのために', scope: 'sentence-initial' },
      { surface: 'その結果', scope: 'sentence-initial' },
      { surface: 'それで',   scope: 'sentence-initial' },
      { surface: 'だからこそ', scope: 'sentence-initial' },
      { surface: 'よって',   scope: 'sentence-initial' },
      { surface: 'したがって', scope: 'sentence-initial' },
      { surface: 'ゆえに',   scope: 'sentence-initial' },
    ],
  },
  {
    id: 'REJECT-REASONING',
    category: 'causal.reject',
    gloss_ja: '因果否認',
    gloss_en: 'reject-reasoning',
    cognitive_effect: '相手の因果推論を「それだけでは結論できない」と切る',
    triggers: [
      { surface: 'からといって', scope: 'anywhere' },
      { surface: 'からって',     scope: 'anywhere' },
    ],
  },

  // =========================================================
  // 4. EPISTEMIC / EVIDENTIAL / MODALITY
  // =========================================================
  {
    id: 'EPISTEMIC-MAY',
    category: 'epistemic.possibility',
    gloss_ja: '可能性',
    gloss_en: 'epistemic-may',
    cognitive_effect: '断定を回避して可能性として置く',
    triggers: [
      { surface: 'かもしれません', scope: 'sentence-final' },
      { surface: 'かもしれない',   scope: 'sentence-final' },
      { surface: 'かもしれん',     scope: 'sentence-final' },
      { surface: 'かもね',         scope: 'sentence-final' },
      { surface: 'かも',           scope: 'sentence-final' },
    ],
  },
  {
    id: 'EPISTEMIC-EXPECT',
    category: 'epistemic.expectation',
    gloss_ja: '当然予測',
    gloss_en: 'epistemic-expect',
    cognitive_effect: '論理的必然として位置付ける',
    triggers: [
      { surface: 'はずです', scope: 'sentence-final' },
      { surface: 'はずだ',   scope: 'sentence-final' },
      { surface: 'はず',     scope: 'sentence-final' },
    ],
  },
  {
    id: 'EPISTEMIC-THINK',
    category: 'epistemic.belief',
    gloss_ja: '私見化',
    gloss_en: 'epistemic-think',
    cognitive_effect: '主張を「私の意見」として責任を引き受けつつ反論余地を残す',
    triggers: [
      { surface: 'と思います', scope: 'sentence-final' },
      { surface: 'と思う',     scope: 'sentence-final' },
      { surface: 'って思う',   scope: 'sentence-final' },
      { surface: 'かと思います', scope: 'sentence-final' },
    ],
  },
  // =========================================================
  // conjecture-frame 構文族 (でしょ/だろう = 推量核) — 旧 EPISTEMIC-POL-WILL を解体
  // ---------------------------------------------------------
  // 「わけ」「んです」と同型。推量核 (でしょ/だろう) + 相互行為ベクトル
  // (ø/ね/か/上昇調) の積。ただし推量核は *非確言的* (probable, not factual)
  // ゆえベクトルの force も和らぐ: ね=共感的な推量共有, か=推量疑問, 上昇=確認誘い。
  // 実コーパス ZOsf8: ø9 / ね4 / か3 / でしょ?(appeal)8。でしょ(上昇・うなし)は
  // 旧 lexicon に *存在せず* 8 件の確認要請を取りこぼしていた。
  // frame note が認識的地位(推量)を運び、act は base 規則(question/confirm-tail)を尊重。
  // =========================================================
  {
    id: 'CONJECTURE-ALIGN',
    category: 'epistemic.conjecture',
    family: 'conjecture-frame',
    gloss_ja: '推量+共感(ね)',
    gloss_en: 'conjecture-align',
    cognitive_effect: '「〜でしょうね／だろうね」推量を ね で共有し共感的同意を誘う',
    triggers: [
      { surface: 'でしょうね', scope: 'sentence-final' },
      { surface: 'だろうね',   scope: 'sentence-final' },
    ],
    priority: 6,
  },
  {
    id: 'CONJECTURE-PROBE',
    category: 'epistemic.conjecture',
    family: 'conjecture-frame',
    gloss_ja: '推量疑問(か)',
    gloss_en: 'conjecture-probe',
    cognitive_effect: '「〜でしょうか／だろうか」推量を疑問化し問いとして差し出す',
    triggers: [
      { surface: 'でしょうか', scope: 'sentence-final' },
      { surface: 'だろうか',   scope: 'sentence-final' },
    ],
    priority: 6,
  },
  {
    id: 'CONJECTURE-APPEAL',
    category: 'epistemic.conjecture',
    family: 'conjecture-frame',
    gloss_ja: '推量→確認誘い',
    gloss_en: 'conjecture-appeal',
    cognitive_effect: '「〜でしょ／だろ」(上昇調)推量を聴き手の既知として確認に引き込む',
    triggers: [
      { surface: 'でしょ', scope: 'sentence-final' },
      { surface: 'だろ',   scope: 'sentence-final' },
    ],
    priority: 6,
  },
  {
    id: 'CONJECTURE-STATE',
    category: 'epistemic.conjecture',
    family: 'conjecture-frame',
    gloss_ja: '推量提示',
    gloss_en: 'conjecture-state',
    cognitive_effect: '「〜でしょう／だろう」婉曲推量で柔らかく断定 (非確言)',
    triggers: [
      { surface: 'でしょう', scope: 'sentence-final' },
      { surface: 'だろう',   scope: 'sentence-final' },
    ],
    priority: 6,
  },
  {
    id: 'EVIDENTIAL-SEEM',
    category: 'evidential.inference',
    gloss_ja: '見え方',
    gloss_en: 'evidential-seem',
    cognitive_effect: '直接情報源を持たず、外見・印象として提示',
    triggers: [
      { surface: 'みたいです', scope: 'sentence-final' },
      { surface: 'みたい',     scope: 'sentence-final' },
      { surface: 'ようです',   scope: 'sentence-final' },
      { surface: 'ようだ',     scope: 'sentence-final' },
    ],
  },
  {
    id: 'EVIDENTIAL-HEARSAY',
    category: 'evidential.hearsay',
    gloss_ja: '伝聞',
    gloss_en: 'evidential-hearsay',
    cognitive_effect: '責任を情報源に転送する',
    triggers: [
      { surface: 'らしいです', scope: 'sentence-final' },
      { surface: 'らしい',     scope: 'sentence-final' },
      { surface: 'そうです',   scope: 'sentence-final', requires_preceding: '[たる]' },
      { surface: 'と聞いた',   scope: 'sentence-final' },
      { surface: 'って聞いた', scope: 'sentence-final' },
      { surface: 'と言われ',   scope: 'anywhere' },
      { surface: 'と言われている', scope: 'sentence-final' },
    ],
  },

  // =========================================================
  // 5. NOMINALIZER / META / REFORMULATION FAMILY
  // =========================================================
  {
    id: 'NOMINALIZE-AS-CHOICE',
    category: 'nominalization.choice',
    gloss_ja: '行為の名詞化',
    gloss_en: 'nominalize-as-choice',
    cognitive_effect: '行為を名詞化して評価対象に変える',
    triggers: [
      { surface: 'ということ', scope: 'after-clause' },
      { surface: 'ってこと',   scope: 'after-clause' },
      { surface: 'のは',       scope: 'after-clause' },
      { surface: 'のが',       scope: 'after-clause' },
      { surface: 'のを',       scope: 'after-clause' },
      { surface: 'こと',       scope: 'after-clause', not_after: ['という','って'] },
    ],
    priority: 5,
  },
  {
    id: 'META-WRAP',
    category: 'meta.wrap',
    gloss_ja: 'メタ収束',
    gloss_en: 'meta-wrap',
    cognitive_effect: '主張全体を「〜という理解／話／こと」として包み込む',
    triggers: [
      { surface: 'という理解', scope: 'sentence-final' },
      { surface: 'という話',   scope: 'sentence-final' },
      { surface: 'という考え', scope: 'sentence-final' },
      { surface: 'という意味', scope: 'sentence-final' },
      { surface: 'というわけです', scope: 'sentence-final' },
      { surface: 'ということです', scope: 'sentence-final' },
      { surface: 'ということなんです', scope: 'sentence-final' },
      { surface: 'ってことです', scope: 'sentence-final' },
      { surface: 'ってことなんです', scope: 'sentence-final' },
    ],
    priority: 7,
  },
  {
    id: 'META-INFERENCE',
    category: 'meta.infer',
    gloss_ja: 'メタ推論',
    gloss_en: 'meta-inference',
    cognitive_effect: '前文全体から「ということは」で結論を引き出す',
    triggers: [
      { surface: 'ということは', scope: 'sentence-initial' },
      { surface: 'ってことは',   scope: 'sentence-initial' },
      { surface: 'ってことか',   scope: 'sentence-final' },
    ],
  },
  {
    id: 'REFORMULATE-REPAIR',
    category: 'meta.repair',
    gloss_ja: '言い換え修復',
    gloss_en: 'reformulate-repair',
    cognitive_effect: '前言の言い直し・キャンセル → 直前の operator 出力を破棄',
    triggers: [
      { surface: 'というか',     scope: 'sentence-initial' },
      { surface: 'っていうか',   scope: 'sentence-initial' },
      { surface: 'と言いますか', scope: 'sentence-initial' },
      { surface: 'と言うか',     scope: 'sentence-initial' },
      { surface: 'というよりも', scope: 'sentence-initial' },
      { surface: 'というより',   scope: 'sentence-initial' },
      { surface: 'そうじゃなくて', scope: 'sentence-initial' },
      { surface: 'じゃなくて',   scope: 'clause-final' },
    ],
    closes_span: 'asserted',
    priority: 7,
  },
  {
    id: 'REFORMULATE-SUMMARIZE',
    category: 'meta.summarize',
    gloss_ja: '要約',
    gloss_en: 'reformulate-summarize',
    cognitive_effect: '直前の展開を一語に圧縮して再パッケージ',
    triggers: [
      { surface: 'つまり',   scope: 'sentence-initial' },
      { surface: 'すなわち', scope: 'sentence-initial' },
      { surface: '要するに', scope: 'sentence-initial' },
      { surface: '言い換えれば', scope: 'sentence-initial' },
    ],
  },
  {
    id: 'PERSPECTIVE-STAGE-OPEN',
    category: 'discourse.perspective-stage',
    role: 'perspective-stage',   // ピボットではない。切断点ではなく舞台上げ。
    gloss_ja: '視座導入',
    gloss_en: 'perspective-stage-open',
    // 注意: これは「定義開始」ではない。既知の指示対象を共通舞台に引き上げ、
    // 続く述語(性質・評価・伝記事実)を共有前提として貼り付ける所作。
    // 真の定義 (X というのは Y です ── Y が同一性識別子)は
    // 将来 relations.mjs で派生 op として合成する予定。
    cognitive_effect: '既知の指示対象を共通舞台に引き上げ、続く述語を共有前提として貼り付ける(定義開始ではない)',
    triggers: [
      { surface: 'というのは',   scope: 'anywhere' },
      { surface: 'っていうのは', scope: 'anywhere' },
      { surface: 'とは',         scope: 'after-noun', not_after: ['なん','どう','こう','そう'] },
    ],
    opens_span: 'perspective-stage',
  },

  // =========================================================
  // 6. QUOTATIVE / ATTRIBUTION FAMILY
  // =========================================================
  {
    id: 'QUOTATIVE-SPEECH',
    category: 'quotative.speech',
    gloss_ja: '直接引用',
    gloss_en: 'quotative-speech',
    cognitive_effect: '他者の発話を引用枠に閉じ込めて責任を分離する',
    triggers: [
      { surface: 'と言った',     scope: 'after-clause' },
      { surface: 'と言って',     scope: 'after-clause' },
      { surface: 'と言う',       scope: 'after-clause' },
      { surface: 'と言ってた',   scope: 'after-clause' },
      { surface: 'って言った',   scope: 'after-clause' },
      { surface: 'って言って',   scope: 'after-clause' },
      { surface: 'って言ってた', scope: 'after-clause' },
      { surface: 'と書い',       scope: 'after-clause' },
    ],
    closes_span: 'quotative',
  },
  {
    id: 'QUOTATIVE-ATTRIB',
    category: 'quotative.attribution',
    gloss_ja: '内容指示',
    gloss_en: 'quotative-attribution',
    cognitive_effect: '名詞・概念を「〜という X」で限定指示',
    triggers: [
      { surface: 'という',   scope: 'after-clause' },
      { surface: 'っていう', scope: 'after-clause' },
    ],
    opens_span: 'quotative',
  },
  // ---------------------------------------------------------
  // quotative-core 構文族 (って = 引用核) の解体
  // ---------------------------------------------------------
  // 実コーパス ZOsf8 で って は最頻ベクトル (計364)。内訳:
  //   話題 Xって 213 / っていう 95 / って言・思 29 / って。17 / ってこと 10。
  // 圧倒的多数 (213) が *話題提示* であり、「引用」枠は書き言葉バイアス。
  // 話し言葉の って は X を相手の前に立てる「取り上げ核」。旧 lexicon は
  // この 213 件を捕捉せず (っていう/って言 のみ)、最大の不可視ベクトルだった。
  {
    id: 'TOPIC-PRESENT',
    category: 'topic.present-colloquial',
    family: 'quotative-core',
    gloss_ja: '話題取り上げ(って)',
    gloss_en: 'topic-present',
    cognitive_effect: '「Xって」で対象を話題として相手の前に立てる (口語の取り上げ)',
    triggers: [
      // 名詞直後の って。引用動詞・命題化・整列マーカー (いう/言/思/聞/書/考/話/こと/ね/さ) は除外。
      { surface: 'って', scope: 'after-noun',
        not_before: ['言', 'いう', 'いっ', 'い、', '思', 'おも', '聞', '書', '考', '話', 'はな', 'こと', 'ね', 'さ'] },
    ],
    opens_span: 'topic-stage',
    priority: 4,
  },
  {
    id: 'HEARSAY-TOSS',
    category: 'evidential.hearsay-toss',
    family: 'quotative-core',
    gloss_ja: '伝聞放り(って)',
    gloss_en: 'hearsay-toss',
    cognitive_effect: '「〜んだって／なんだって」他者の言を引用したまま聴き手に放り評価を委ねる',
    triggers: [
      // 高精度形のみ (て形の依頼「買って。」等の誤検出を避け、非確言の節末核に限定)。
      { surface: 'なんだって', scope: 'sentence-final' },
      { surface: 'んだって',   scope: 'sentence-final' },
      { surface: 'るんだって', scope: 'sentence-final' },
    ],
    closes_span: 'quotative',
    priority: 7,
  },
  {
    id: 'AUTHORITY-TRANSFER',
    category: 'quotative.authority',
    gloss_ja: '権威転送',
    gloss_en: 'authority-transfer',
    cognitive_effect: '判定権を外部の権威に転送 → 自分の主張に見せない',
    triggers: [
      { surface: 'によると',     scope: 'clause-final' },
      { surface: 'によれば',     scope: 'clause-final' },
      { surface: '的に言えば',   scope: 'clause-final' },
      { surface: 'からすると',   scope: 'clause-final' },
      { surface: 'からすれば',   scope: 'clause-final' },
      { surface: '的に言うと',   scope: 'clause-final' },
      { surface: 'が言っている', scope: 'clause-final' },
      { surface: 'が言ってる',   scope: 'clause-final' },
    ],
  },
  {
    id: 'PUTATIVE-ASCRIBE',
    category: 'quotative.putative',
    gloss_ja: '動機帰属',
    gloss_en: 'putative-ascribe',
    cognitive_effect: '聞き手の行為に「こういう動機・思いがあった」と仮の動機を植え付ける',
    triggers: [
      { surface: 'と思って',     scope: 'clause-final' },
      { surface: 'って思って',   scope: 'clause-final' },
      { surface: 'と思ってた',   scope: 'clause-final' },
      { surface: 'って思ってた', scope: 'clause-final' },
      { surface: 'つもりで',     scope: 'clause-final' },
      { surface: 'のつもりで',   scope: 'clause-final' },
      { surface: '気持ちで',     scope: 'clause-final' },
      { surface: 'からって',     scope: 'clause-final' },
    ],
  },

  // =========================================================
  // 7. GROUND-CLAIM / CONFIRMATION FAMILY
  // =========================================================
  {
    id: 'GROUND-CLAIM',
    category: 'illocution.ground',
    gloss_ja: '共通基盤主張',
    gloss_en: 'ground-claim',
    cognitive_effect: '自分の主張を「既に共有されている前提」として埋め込む',
    triggers: [
      { surface: 'じゃないですか', scope: 'sentence-final' },
      { surface: 'じゃないですかね', scope: 'sentence-final' },
      { surface: 'じゃないか',     scope: 'sentence-final' },
      { surface: 'じゃん',         scope: 'sentence-final' },
      { surface: 'んじゃない',     scope: 'sentence-final' },
    ],
    priority: 5,
  },
  {
    id: 'CONFIRMATION-SEEK',
    category: 'illocution.confirm-seek',
    gloss_ja: '同意要求',
    gloss_en: 'confirmation-seek',
    cognitive_effect: '聞き手に確認を求めて承認させる',
    triggers: [
      { surface: 'ですよね', scope: 'sentence-final' },
      { surface: 'でしょ',   scope: 'sentence-final' },
      { surface: 'よね',     scope: 'sentence-final' },
      { surface: 'だよね',   scope: 'sentence-final' },
      // 裸の ね: 述語直後 + 節末 (行くね、/ですます形の後) のみ。それ以外は棄権。
      // ですね/だね は AGREE-MARK が長一致で勝つ。
      { surface: 'ね', scope: 'clause-final', requires_after_predicate: true, not_after: ['です', 'だ'] },
    ],
  },
  {
    id: 'AGREE-MARK',
    category: 'illocution.agree',
    gloss_ja: '同調',
    gloss_en: 'agree-mark',
    cognitive_effect: '聞き手として同意・共有を示す',
    triggers: [
      // clause-final: 文末に加え「そうですね、でも…」の節末同調も拾う。
      { surface: 'ですね', scope: 'clause-final' },
      { surface: 'だね',   scope: 'clause-final' },
      { surface: 'もんね', scope: 'sentence-final' },
    ],
  },
  // =========================================================
  // explain-frame 構文族 (の/ん = 説明核) — 旧 EXPLAIN-NOMINAL を解体
  // ---------------------------------------------------------
  // 「んです」も「わけ」と同型: 叙法核(の/ん) + 相互行為ベクトル
  // (ø/よ/ね/よね/から) の *積*。同じベクトルが reason-frame と横断的に
  // 同一 MOVE を担う (実コーパス ZOsf8: んですよ=開示54 / んですね=整列32 /
  // んですけ=留保86 / んだから=因果4 / んです=中立62)。旧 op は 272 件を
  // 「説明モード」1つに潰し、開示/整列/留保/因果の関係差を消していた。
  // move = f(ベクトル, 核): 核がベクトルの力を変調する (ん+ね は提示的で
  // act 据え置き / わけ+ね は承認要請に上がる) → hint は interaction.mjs で
  // opId 別に調律。
  // =========================================================
  {
    id: 'EXPLAIN-CAUSE',
    category: 'nominalization.explanatory',
    family: 'explain-frame',
    gloss_ja: '説明→因果前提',
    gloss_en: 'explain-cause',
    cognitive_effect: '「〜んだから／んですから」説明を後続の論拠(ground)として差し出す',
    triggers: [
      { surface: 'んですから', scope: 'sentence-final' },
      { surface: 'んだから',   scope: 'sentence-final' },
    ],
    priority: 6,
  },
  {
    id: 'EXPLAIN-CONFIRM',
    category: 'nominalization.explanatory',
    family: 'explain-frame',
    gloss_ja: '説明→確認要請',
    gloss_en: 'explain-confirm',
    cognitive_effect: '「〜んですよね／んだよね」説明を共有済みとして承認を求める',
    triggers: [
      { surface: 'んですよね', scope: 'sentence-final' },
      { surface: 'んだよね',   scope: 'sentence-final' },
    ],
    priority: 6,
  },
  {
    id: 'EXPLAIN-REVEAL',
    category: 'nominalization.explanatory',
    family: 'explain-frame',
    gloss_ja: '説明→開示',
    gloss_en: 'explain-reveal',
    cognitive_effect: '「〜んですよ／んだよ」説明を聴き手に押し出し開示する (語りの山場)',
    triggers: [
      { surface: 'んですよ', scope: 'sentence-final' },
      { surface: 'んだよ',   scope: 'sentence-final' },
    ],
    priority: 6,
  },
  {
    id: 'EXPLAIN-ALIGN',
    category: 'nominalization.explanatory',
    family: 'explain-frame',
    gloss_ja: '説明提示(ね)',
    gloss_en: 'explain-align',
    cognitive_effect: '「〜んですね／んだね」説明を ね で和らげ低コストの同意を誘う (提示的)',
    triggers: [
      { surface: 'んですね', scope: 'sentence-final' },
      { surface: 'んだね',   scope: 'sentence-final' },
    ],
    priority: 6,
  },
  {
    id: 'EXPLAIN-STATE',
    category: 'nominalization.explanatory',
    family: 'explain-frame',
    gloss_ja: '説明提示',
    gloss_en: 'explain-state',
    cognitive_effect: '事実を「〜んです／のだ」枠で説明として中立提示',
    triggers: [
      { surface: 'んです', scope: 'sentence-final' },
      { surface: 'のです', scope: 'sentence-final' },
      { surface: 'んだ',   scope: 'sentence-final' },
      { surface: 'のだ',   scope: 'sentence-final' },
    ],
    priority: 6,
  },
  {
    id: 'EXPLAIN-HEDGE',
    category: 'nominalization.explanatory-hedge',
    family: 'explain-frame',
    gloss_ja: '説明→留保(けど)',
    gloss_en: 'explain-hedge',
    cognitive_effect: '「〜んですけど／んだけど」説明を背景として置き、続きへ開く (留保・projection)',
    triggers: [
      { surface: 'んですけど',       scope: 'sentence-final' },
      { surface: 'んですけれど',     scope: 'sentence-final' },
      { surface: 'んですけれども',   scope: 'sentence-final' },
      { surface: 'んだけど',         scope: 'sentence-final' },
      { surface: 'んだけれど',       scope: 'sentence-final' },
      { surface: 'んだけれども',     scope: 'sentence-final' },
      { surface: 'のですが',         scope: 'sentence-final' },
      { surface: 'のですけれども',   scope: 'sentence-final' },
    ],
    priority: 6,
  },

  // =========================================================
  // 8. DEONTIC / NORMATIVE
  // =========================================================
  {
    id: 'NORMATIVE',
    category: 'deontic.normative',
    gloss_ja: '規範化',
    gloss_en: 'normative',
    cognitive_effect: '行為を「こうすべき」と規範化',
    triggers: [
      { surface: 'べきです',     scope: 'sentence-final' },
      { surface: 'べきだ',       scope: 'sentence-final' },
      { surface: 'べきではない', scope: 'sentence-final' },
      { surface: 'べき',         scope: 'sentence-final' },
    ],
  },
  {
    id: 'DEONTIC-MUST',
    category: 'deontic.necessity',
    gloss_ja: '必須',
    gloss_en: 'deontic-must',
    cognitive_effect: '行為を「やらねばならない」と必然化',
    triggers: [
      { surface: 'なければなりません', scope: 'sentence-final' },
      { surface: 'なければならない',   scope: 'sentence-final' },
      { surface: 'なければいけません', scope: 'sentence-final' },
      { surface: 'なければいけない',   scope: 'sentence-final' },
      { surface: 'なきゃいけない',     scope: 'sentence-final' },
      { surface: 'なきゃ',             scope: 'sentence-final' },
      { surface: 'ないと',             scope: 'sentence-final' },
    ],
  },
  {
    id: 'ADVICE-BETTER',
    category: 'deontic.advice',
    gloss_ja: '助言',
    gloss_en: 'advice-better',
    cognitive_effect: '相手の行為を間接的に方向付け',
    triggers: [
      { surface: 'たほうがいい',     scope: 'sentence-final' },
      { surface: 'たほうがよい',     scope: 'sentence-final' },
      { surface: 'たほうがいいです', scope: 'sentence-final' },
    ],
  },

  // =========================================================
  // 9. ANAPHORIC / CATEGORICAL FAMILY (the heart of common-ground manipulation)
  // =========================================================
  {
    id: 'CLASS-LIFT',
    category: 'anaphora.class-lift',
    gloss_ja: '類化',
    gloss_en: 'class-lift',
    cognitive_effect: '個別事例を「そういう類」として抽象化 → 反論コストを上げる',
    triggers: [
      { surface: 'そういう類',       scope: 'anywhere' },
      { surface: 'そういう感じ',     scope: 'anywhere' },
      { surface: 'そういう意味で',   scope: 'anywhere' },
      { surface: 'そういう意味では', scope: 'anywhere' },
      { surface: 'そういう理由で',   scope: 'anywhere' },
      { surface: 'そういう理由から', scope: 'anywhere' },
      { surface: 'そういうわけで',   scope: 'anywhere' },
      { surface: 'そういうことで',   scope: 'anywhere' },
      { surface: 'そういうの',       scope: 'anywhere' },
      { surface: 'そういう人',       scope: 'anywhere' },
      { surface: 'そういう話',       scope: 'anywhere' },
      { surface: 'そういう',         scope: 'anywhere' },
      { surface: 'そんな感じ',       scope: 'anywhere' },
      { surface: 'そんなの',         scope: 'anywhere' },
      { surface: 'そんな',           scope: 'anywhere' },
    ],
    priority: 5,
  },
  {
    id: 'ANAPHORIC-TYPECALL',
    category: 'anaphora.typecall',
    gloss_ja: '指示参照',
    gloss_en: 'anaphoric-typecall',
    cognitive_effect: '直前の言及を一語で呼び戻す',
    triggers: [
      { surface: 'それが',   scope: 'sentence-initial' },
      { surface: 'それは',   scope: 'sentence-initial' },
      { surface: 'それを',   scope: 'sentence-initial' },
      { surface: 'これが',   scope: 'sentence-initial' },
      { surface: 'これは',   scope: 'sentence-initial' },
      { surface: 'この',     scope: 'sentence-initial' },
      { surface: 'その',     scope: 'sentence-initial' },
    ],
    priority: 2,
  },
  {
    id: 'TOPIC-SHIFT',
    category: 'topic.shift',
    gloss_ja: '話題転換',
    gloss_en: 'topic-shift',
    cognitive_effect: 'ローカル話題を切り上げて新トピックを開く',
    triggers: [
      { surface: 'ところで',     scope: 'sentence-initial' },
      { surface: 'それはそうと', scope: 'sentence-initial' },
      { surface: 'さて',         scope: 'sentence-initial' },
      { surface: 'では',         scope: 'sentence-initial' },
      { surface: 'それでは',     scope: 'sentence-initial' },
    ],
    priority: 6,
  },
  {
    id: 'FILLER-HESITATION',
    category: 'discourse.filler',
    gloss_ja: 'フィラー・間取り',
    gloss_en: 'filler-hesitation',
    cognitive_effect: '即興的な計画停滞 → 次の語句構成までの間取り。後続の語の重要性を予告するピボット開口部としても機能',
    triggers: [
      { surface: 'あのー',   scope: 'anywhere' },
      { surface: 'あの、',   scope: 'anywhere' },
      { surface: 'えっと',   scope: 'anywhere' },
      { surface: 'えーと',   scope: 'anywhere' },
      { surface: 'えー、',   scope: 'sentence-initial' },
      { surface: 'うーん',   scope: 'sentence-initial' },
      { surface: 'まあ、',   scope: 'sentence-initial' },
    ],
    priority: 1,
  },
  // --- DISCOURSE-LAYER BUNDLES (derived in structure.mjs, no triggers) ---
  {
    id: 'TYPE-FRAME-CONFIRMED',
    category: 'discourse.bundle',
    gloss_ja: '型枠+期待確認',
    gloss_en: 'type-frame-confirmed',
    cognitive_effect: 'PERSPECTIVE-STAGE-OPEN(っていうのは)+TEMPORAL-NOW(もう)+EXPECTATION-CONFIRM(やはり) → 「Xはやはりもうこういうものだ」枠を共有前提として書き込む',
    layer: 'd',
    triggers: [],
    derived_from: ['PERSPECTIVE-STAGE-OPEN', 'TEMPORAL-NOW', 'EXPECTATION-CONFIRM'],
    priority: 12,
  },
  {
    id: 'PIVOT-OPEN-FILLER',
    category: 'discourse.bundle',
    gloss_ja: 'フィラー+型枠開口',
    gloss_en: 'pivot-open-filler',
    cognitive_effect: 'FILLER-HESITATION(あの)+PERSPECTIVE-STAGE-OPEN(っていうのは) → 計画停滞の後で重い名詞句を舞台に上げる',
    layer: 'd',
    triggers: [],
    derived_from: ['FILLER-HESITATION', 'PERSPECTIVE-STAGE-OPEN'],
    priority: 11,
  },
  {
    id: 'GROUND-SOFTEN-PIVOT',
    category: 'discourse.bundle',
    gloss_ja: '基盤化+逆接緩衝',
    gloss_en: 'ground-soften-pivot',
    cognitive_effect: 'EXPLAIN-NOMINAL(なんですけど(も))が文中央で機能 → 左辺=前提宣言、右辺=主張本体。基盤共有を演出しつつ右辺へ重心',
    layer: 'd',
    triggers: [],
    derived_from: ['EXPLAIN-NOMINAL'],
    priority: 11,
  },
  // --- DISCOURSE-MOVE ops (single semantic moves built from multiple primitives) ---
  {
    id: 'STANCE-PACKAGE',
    category: 'discourse.stance',
    gloss_ja: '共有前提パッケージ',
    gloss_en: 'stance-package',
    cognitive_effect: '時点固定(もう)+期待確認(やはり/やっぱり) を一つの「君も既に知っているはずだよね」 として束ね、聞き手の同意を予め買い込む',
    layer: 'd',
    triggers: [],
    derived_from: ['TEMPORAL-NOW', 'EXPECTATION-CONFIRM'],
    priority: 13,
  },
  {
    id: 'PARALLEL-FRAME-COUPLE',
    category: 'discourse.parallel',
    gloss_ja: '対立対枠',
    gloss_en: 'parallel-frame-couple',
    cognitive_effect: '同じラベルの枠が逆接(けど/が)を挟んで二度開かれる → 二極対比構造。左枠=立論主体, 右枠=対抗主体。両者は独立ではなく対の片割れ',
    layer: 'd',
    triggers: [],
    derived_from: ['PERSPECTIVE-STAGE-OPEN', 'CONCESSIVE-CONTRAST'],
    priority: 14,
  },
  {
    id: 'SUSPENDED-NARRATIVE',
    category: 'discourse.narrative',
    gloss_ja: '宙吊り叙述',
    gloss_en: 'suspended-narrative',
    cognitive_effect: '文末「と」で引用を閉じる動詞を出さず → 命題を伝記的事実として聴き手に手渡す。ダングリング・クォートではなく意図的な放置',
    layer: 'd',
    triggers: [],
    derived_from: ['QUOTATIVE-ATTRIB'],
    priority: 13,
  },
  {
    id: 'NARRATIVE-LAUNCH',
    category: 'discourse.narrative',
    gloss_ja: '叙述開始',
    gloss_en: 'narrative-launch',
    cognitive_effect: '「でね/それで/それでね」で前のターンを引き取りつつ新しい伝記的展開を起動 → 単なる話題マーカーではなく語りの拍を打ち直す',
    layer: 'd',
    triggers: [],
    derived_from: [],
    priority: 12,
  },
  {
    id: 'FRAME-PIVOT',
    category: 'syntax.frame-pivot',
    gloss_ja: '枠回転',
    gloss_en: 'frame-pivot',
    cognitive_effect: '同じ対象に対する「問いそのもの」を変えて評価軸を回す',
    triggers: [
      { surface: '問いを変える', scope: 'anywhere' },
      { surface: '問いを変えて', scope: 'anywhere' },
      { surface: '視点を変える', scope: 'anywhere' },
      { surface: '見方を変える', scope: 'anywhere' },
      { surface: '逆に',         scope: 'sentence-initial' },
      { surface: '裏返せば',     scope: 'sentence-initial' },
    ],
  },

  // =========================================================
  // 10. EXEMPLIFY / APPROXIMATE
  // =========================================================
  {
    id: 'EXEMPLIFY',
    category: 'quantification.exemplify',
    gloss_ja: '例示',
    gloss_en: 'exemplify',
    cognitive_effect: '具体例で抽象主張を支える / 抽象主張から個別へ降りる',
    triggers: [
      { surface: 'たとえば',   scope: 'sentence-initial' },
      { surface: '例えば',     scope: 'sentence-initial' },
      { surface: 'とか',       scope: 'after-noun' },
      { surface: 'なんか',     scope: 'after-noun', requires_following: '[、。]' },
    ],
  },
  {
    id: 'APPROXIMATIVE',
    category: 'quantification.approximate',
    gloss_ja: '近似化',
    gloss_en: 'approximative',
    cognitive_effect: '名指しを避けて「〜的な／〜みたいな」で曖昧化',
    triggers: [
      { surface: 'みたいな',   scope: 'after-noun' },
      { surface: 'っぽい',     scope: 'sentence-final' },
      // 口語近似の「的な」は かな/引用閉じ の直後のみ (帰りたい的な/」的な)。
      // 漢語連体形 (個人的な/基本的な = 漢字直前) は修辞ジェスチャーではない。
      { surface: '的な',       scope: 'after-noun', requires_preceding: '[ぁ-ん」』]' },
      { surface: 'みたいなの', scope: 'after-noun' },
      { surface: 'みたいの',   scope: 'after-noun' },
      { surface: 'って感じ',   scope: 'sentence-final' },
      { surface: 'という感じ', scope: 'sentence-final' },
    ],
  },

  // =========================================================
  // 11. SUSPEND / OPEN-ENDED (relation-driven, fired by relations.mjs)
  // =========================================================
  {
    id: 'SUSPEND-APODOSIS',
    category: 'syntax.suspend-apodosis',
    gloss_ja: '帰結停止',
    gloss_en: 'suspend-apodosis',
    cognitive_effect: '条件節の帰結を述べずに句点 → 聞き手に補完させる',
    triggers: [
      // No direct triggers; emitted by relations.mjs when CONDITIONAL-ANTECEDENT
      // span closes at sentence-final without a CONSEQUENT.
    ],
  },
  {
    id: 'DANGLING-QUOTE',
    category: 'quotative.dangling',
    gloss_ja: '宙吊り引用',
    gloss_en: 'dangling-quote',
    cognitive_effect: '引用枠を閉じずに放置 → 誰の発話か不明にしたまま流す',
    triggers: [
      // emitted by relations.mjs when QUOTATIVE-ATTRIB span never closes
    ],
  },

  // =========================================================
  // 12. ASPECTUAL / EVALUATIVE (often modify the operator chain)
  // =========================================================
  {
    id: 'ASPECT-COMPLETIVE',
    category: 'aspect.completive',
    gloss_ja: '完了・しまった感',
    gloss_en: 'aspect-completive',
    cognitive_effect: '行為の完了に「残念さ／断絶」のニュアンスを付与',
    triggers: [
      { surface: 'てしまいました', scope: 'sentence-final' },
      { surface: 'てしまった',     scope: 'sentence-final' },
      { surface: 'てしまう',       scope: 'sentence-final' },
      { surface: 'ちゃった',       scope: 'sentence-final' },
      { surface: 'ちゃう',         scope: 'sentence-final' },
    ],
  },
  {
    id: 'BENEFACTIVE-IN',
    category: 'voice.benefactive-in',
    gloss_ja: '〜してくれる',
    gloss_en: 'benefactive-in',
    cognitive_effect: '相手の行為を「自分への恩恵」として枠付け',
    triggers: [
      { surface: 'てくれる',     scope: 'sentence-final' },
      { surface: 'てくれて',     scope: 'clause-final' },
      { surface: 'てくれた',     scope: 'sentence-final' },
      { surface: 'てくださる',   scope: 'sentence-final' },
      { surface: 'てくださって', scope: 'clause-final' },
    ],
  },
  {
    id: 'BENEFACTIVE-RECEIVE',
    category: 'voice.benefactive-receive',
    gloss_ja: '〜してもらう',
    gloss_en: 'benefactive-receive',
    cognitive_effect: '自分が恩恵を受ける構図 → 相手を行為主体に立てる',
    triggers: [
      { surface: 'てもらう',       scope: 'sentence-final' },
      { surface: 'てもらって',     scope: 'clause-final' },
      { surface: 'ていただく',     scope: 'sentence-final' },
      { surface: 'ていただいて',   scope: 'clause-final' },
      { surface: 'ていただきまして', scope: 'clause-final' },
    ],
  },

  // =========================================================
  // 13. BACKCHANNEL / BUILD-ON (turn-level)
  // =========================================================
  {
    id: 'BUILD-ON',
    category: 'turn.build-on',
    gloss_ja: '受け継ぎ',
    gloss_en: 'build-on',
    cognitive_effect: '相手の発話を受け止めた上で自分の発話を接続',
    triggers: [
      { regex: /^(うん|はい|ええ|そう|そうそう|なるほど)[、，]/, scope: 'sentence-initial' },
    ],
  },
  {
    id: 'REJECT-CORRECTION',
    category: 'turn.reject-correction',
    gloss_ja: '修復・否定',
    gloss_en: 'reject-correction',
    cognitive_effect: '相手の前提を切ってから自分の主張に置き換える',
    triggers: [
      { surface: 'いやいや',         scope: 'sentence-initial' },
      { surface: 'いやいやいや',     scope: 'sentence-initial' },
      { surface: 'いや、',           scope: 'sentence-initial' },
      { surface: 'いえ、',           scope: 'sentence-initial' },
      { surface: 'ちがう',           scope: 'sentence-initial' },
      { surface: '違う',             scope: 'sentence-initial' },
      { surface: 'そうじゃなくて',   scope: 'sentence-initial' },
    ],
    closes_span: 'asserted',
  },

  // =========================================================
  // 14. TOPIC / FOCUS (multi-char particles only — single は handled by tokenizer)
  // =========================================================
  {
    id: 'TOPIC-REGARDING',
    category: 'topic.regarding',
    gloss_ja: '〜については',
    gloss_en: 'topic-regarding',
    cognitive_effect: '対象を明示的に話題に立てる',
    triggers: [
      { surface: 'については',     scope: 'after-noun' },
      { surface: 'に関しては',     scope: 'after-noun' },
      { surface: 'に関して',       scope: 'after-noun' },
      { surface: 'にとっては',     scope: 'after-noun' },
      { surface: 'にとって',       scope: 'after-noun' },
    ],
  },

  // =========================================================
  // 15. PRIORITY / RANKING
  // =========================================================
  {
    id: 'PRIORITY-INSTALL',
    category: 'discourse.priority',
    gloss_ja: '優先順位の設置',
    gloss_en: 'priority-install',
    cognitive_effect: '「〜のほうが」「〜より」で評価順序を common ground に置く',
    triggers: [
      { surface: 'のほうが',       scope: 'after-noun' },
      { surface: 'の方が',         scope: 'after-noun' },
      { surface: 'よりも',         scope: 'after-noun' },
      { surface: 'より',           scope: 'after-noun' },
      { surface: 'にしか',         scope: 'after-noun' },
      { surface: 'しかない',       scope: 'sentence-final' },
      { surface: 'こそ',           scope: 'after-noun' },
    ],
  },

  // =========================================================
  // 16. NEGATION / RULING-OUT
  // =========================================================
  {
    id: 'RULE-OUT',
    category: 'negation.ruleout',
    gloss_ja: '可能性排除',
    gloss_en: 'rule-out',
    cognitive_effect: 'ある選択肢を論理的に除外',
    triggers: [
      { surface: 'わけがない',         scope: 'sentence-final' },
      { surface: 'はずがない',         scope: 'sentence-final' },
      { surface: 'わけにはいかない',   scope: 'sentence-final' },
      { surface: 'はずはない',         scope: 'sentence-final' },
      { surface: 'ありえない',         scope: 'sentence-final' },
    ],
  },

  // =========================================================
  // 17. DISCOURSE-RESTRICTOR / EXPECTATION / PROVISIONAL / PRESUPPOSE
  // =========================================================
  {
    id: 'DISCOURSE-RESTRICTOR',
    category: 'discourse.restrict',
    gloss_ja: '但し書き',
    gloss_en: 'discourse-restrictor',
    cognitive_effect: '直前の主張を全面肯定せず留保条件を導入する',
    triggers: [
      { surface: 'ただ、',   scope: 'sentence-initial' },
      { surface: 'ただし、', scope: 'sentence-initial' },
      { surface: 'ただ',     scope: 'sentence-initial' },
      { surface: 'もっとも', scope: 'sentence-initial' },
    ],
    priority: 6,
  },
  {
    id: 'EXPECTATION-CONFIRM',
    category: 'discourse.expect',
    gloss_ja: '予期通り',
    gloss_en: 'expectation-confirm',
    cognitive_effect: '予期していたことが実際そうだったと確認 — 共通知識として処理',
    triggers: [
      { surface: 'やっぱり',   scope: 'anywhere' },
      { surface: 'やっぱ',     scope: 'anywhere' },
      { surface: 'やはり',     scope: 'anywhere' },
      { surface: 'やっぱりね', scope: 'sentence-final' },
    ],
    priority: 5,
  },
  {
    id: 'PROVISIONAL',
    category: 'conditional.provisional',
    gloss_ja: '暫定・仮置き',
    gloss_en: 'provisional',
    cognitive_effect: '行為や状態を「とりあえず・一応」として暫定化 — コミット度を下げる',
    triggers: [
      { surface: '一応',     scope: 'anywhere' },
      { surface: 'とりあえず', scope: 'anywhere' },
      { surface: '一旦',     scope: 'anywhere' },
      { surface: 'いったん', scope: 'anywhere' },
    ],
    priority: 5,
  },
  {
    id: 'PRESUPPOSE-EVOKE',
    category: 'topic.presuppose',
    gloss_ja: '前提化',
    gloss_en: 'presuppose-evoke',
    cognitive_effect: '「もちろん／当然」で論点を最初から共有前提として持ち込む',
    triggers: [
      { surface: 'もちろん', scope: 'anywhere' },
      { surface: '当然',     scope: 'sentence-initial' },
      { surface: '当たり前', scope: 'anywhere' },
      { surface: '言うまでもなく', scope: 'sentence-initial' },
    ],
    priority: 5,
  },
  {
    id: 'EMPHATIC',
    category: 'illocution.emphatic',
    gloss_ja: '強調',
    gloss_en: 'emphatic',
    cognitive_effect: '主張の真剣度・強度を持ち上げる',
    triggers: [
      { surface: '本当に',     scope: 'anywhere' },
      { surface: 'ほんとに',   scope: 'anywhere' },
      { surface: 'ほんとうに', scope: 'anywhere' },
      { surface: 'マジで',     scope: 'anywhere' },
      { surface: '実に',       scope: 'sentence-initial' },
      { surface: '非常に',     scope: 'anywhere' },
      { surface: '極めて',     scope: 'anywhere' },
      // 感動詞的「もう」：評価・感情・談話マーカーが後続する場合のみ（時間的「もう」と区別）
      { surface: 'もう', scope: 'anywhere', requires_following: '[、。，]|もう|だから|なんか|ほんと|まじ|マジ|いや|やだ|嫌|だめ|ダメ|最高|最悪|すご|やば|いい|よく|良く|つら|しんど|うれし|嫉し|楽し|かわい|可愛|ひど|酷|無理|むり|いっぱい|どんどん' },
    ],
  },
  {
    id: 'TEMPORAL-NOW',
    category: 'aspect.now',
    gloss_ja: '時点指示',
    gloss_en: 'temporal-now',
    cognitive_effect: '時点をいま／既に へ確定して語る',
    triggers: [
      // 時間的「もう」：時刻・完了が後続する明確なアスペクト文脈のみ（加算用法は ADDITIVE-INCREMENT、感動詞的用法は EMPHATIC へ）
      { surface: 'もう', scope: 'anywhere', requires_following: 'すぐ|やはり|やっぱ|[0-9０-９]+\\s*[時分秒]|[一二三四五六七八九十]\\s*[時分秒]|終わ|済ん|過ぎ|尽き|帰った|着いた|寝た|来た' },
      { surface: 'すでに',   scope: 'anywhere' },
      { surface: '既に',     scope: 'anywhere' },
      { surface: 'まだ',     scope: 'anywhere' },
    ],
    priority: 2,
  },
  {
    id: 'ADDITIVE-INCREMENT',
    category: 'quantification.additive',
    gloss_ja: '追加・増分',
    gloss_en: 'additive-increment',
    cognitive_effect: '既出の量に「さらに一単位／もう少し」を上乗せする',
    triggers: [
      // 加算の「もう」：数量詞・「一〜」・「少し／ちょっと」が後続（「もう一回」「もう1問」「もう少し」＝あと〜）
      { surface: 'もう', scope: 'anywhere', requires_following: '[0-9０-９]|[一二三四五六七八九]|少し|ちょっと|ひと|いっこ|いっぱい|一寸' },
    ],
  },

  // =========================================================
  // 18. DECISION / INCEPTIVE / HORTATIVE NOMINALIZATION
  // =========================================================
  {
    id: 'DECISION-NOMINALIZE',
    category: 'nominalization.decision',
    gloss_ja: '決定化',
    gloss_en: 'decision-nominalize',
    cognitive_effect: '行為を「〜することにする」で話者の確定的決定として宣言',
    triggers: [
      { surface: 'ことにします',   scope: 'sentence-final' },
      { surface: 'ことにする',     scope: 'sentence-final' },
      { surface: 'ことにした',     scope: 'sentence-final' },
      { surface: 'ことにしました', scope: 'sentence-final' },
      { surface: 'ようにします',   scope: 'sentence-final' },
      { surface: 'ようにする',     scope: 'sentence-final' },
    ],
    priority: 7,
  },
  {
    id: 'INCEPTIVE-NOMINALIZE',
    category: 'nominalization.inceptive',
    gloss_ja: '成り行き化',
    gloss_en: 'inceptive-nominalize',
    cognitive_effect: '行為の発生を「〜することになる」で外的成り行きとして提示 — 話者の決定責任を回避',
    triggers: [
      { surface: 'ことになります',     scope: 'sentence-final' },
      { surface: 'ことになる',         scope: 'sentence-final' },
      { surface: 'ことになった',       scope: 'sentence-final' },
      { surface: 'ことになりました',   scope: 'sentence-final' },
      { surface: 'ようになります',     scope: 'sentence-final' },
      { surface: 'ようになる',         scope: 'sentence-final' },
      { surface: 'ようになった',       scope: 'sentence-final' },
      { surface: 'ようになっている',   scope: 'sentence-final' },
    ],
    priority: 7,
  },
  {
    id: 'HORTATIVE-PROPOSAL',
    category: 'deontic.hortative',
    gloss_ja: '勧誘提案',
    gloss_en: 'hortative-proposal',
    cognitive_effect: '「〜ていこう／〜ましょう」で聞き手を巻き込む提案フレーム',
    triggers: [
      { surface: 'ていこうと思います', scope: 'sentence-final' },
      { surface: 'ていこうと思う',     scope: 'sentence-final' },
      { surface: 'ていきましょう',     scope: 'sentence-final' },
      { surface: 'ていこう',           scope: 'sentence-final' },
      { surface: 'ましょう',           scope: 'sentence-final' },
      { surface: 'ようと思います',     scope: 'sentence-final' },
      { surface: 'ようと思う',         scope: 'sentence-final' },
    ],
    priority: 8,
  },

  // =========================================================
  // 19. EXPERIENTIAL / EXISTENCE OF PAST EXPERIENCE
  // =========================================================
  {
    id: 'EXPERIENTIAL-PAST',
    category: 'aspect.experiential',
    gloss_ja: '経験あり',
    gloss_en: 'experiential-past',
    cognitive_effect: '過去の経験を抽象資源として参照可能化',
    triggers: [
      { surface: 'たことがあります', scope: 'sentence-final' },
      { surface: 'たことがある',     scope: 'sentence-final' },
      { surface: 'たことある',       scope: 'sentence-final' },
      { surface: 'たことがない',     scope: 'sentence-final' },
      { surface: 'たことない',       scope: 'sentence-final' },
      { surface: 'たことありません', scope: 'sentence-final' },
    ],
    priority: 8,
  },
  {
    id: 'EXPERIENTIAL-Q',
    category: 'aspect.experiential-q',
    gloss_ja: '経験確認',
    gloss_en: 'experiential-q',
    cognitive_effect: '聞き手の過去経験を問う — 体験ベースの共通基盤探索',
    triggers: [
      { surface: 'たことありますか', scope: 'sentence-final' },
      { surface: 'たことある?',      scope: 'sentence-final' },
      { surface: 'たことある？',     scope: 'sentence-final' },
    ],
    priority: 8,
  },

  // =========================================================
  // 20. PASSIVE FAMILY (neutral / affected / regretful)
  // =========================================================
  {
    id: 'PASSIVE-HEARSAY',
    category: 'evidential.passive-hearsay',
    gloss_ja: '受身伝聞',
    gloss_en: 'passive-hearsay',
    cognitive_effect: '「〜と言われている」で出所を曖昧化したまま共通知識化',
    triggers: [
      { surface: 'と言われています', scope: 'anywhere' },
      { surface: 'と言われている',   scope: 'anywhere' },
      { surface: 'と言われていた',   scope: 'anywhere' },
      { surface: 'と言われました',   scope: 'sentence-final' },
      { surface: 'と言われた',       scope: 'anywhere' },
      { surface: 'と言われ',         scope: 'anywhere' },
      { surface: 'って言われている', scope: 'anywhere' },
      { surface: 'って言われていた', scope: 'anywhere' },
      { surface: 'って言われた',     scope: 'anywhere' },
      { surface: 'って言われ',       scope: 'anywhere' },
      { surface: 'と呼ばれている',   scope: 'anywhere' },
      { surface: 'と呼ばれていた',   scope: 'anywhere' },
      { surface: 'と呼ばれる',       scope: 'anywhere' },
      { surface: 'と呼ばれた',       scope: 'anywhere' },
      { surface: 'と称される',       scope: 'anywhere' },
      { surface: 'と称された',       scope: 'anywhere' },
    ],
    priority: 7,
  },
  {
    id: 'REGRETFUL-PASSIVE',
    category: 'voice.adversative-passive',
    gloss_ja: '被害受身',
    gloss_en: 'regretful-passive',
    cognitive_effect: '受身+しまった の合成 + 話者スタンス + 不快評価 → 「望まないのに〜された」 被害者性を埋め込む',
    layer: 'd',
    triggers: [],
    derived_from: ['PASSIVE-NEUTRAL', 'PASSIVE-HEARSAY', 'ASPECT-COMPLETIVE'],
    requires_context: [
      '1st-person undergoer (私/僕/俺/うち/こっち)',
      'adversative lexeme (困る/嫌/つらい/まいる/漏れ)',
      'affect particle (もう/・よ final / わ / な final)',
      'adjacent complaint or negative evaluation',
    ],
    priority: 9,
    note: 'grammar primitives PASSIVE + COMPLETIVE alone do NOT entail regret; emission decided in relations.mjs',
  },
  {
    id: 'PASSIVE-NEUTRAL',
    category: 'voice.passive',
    gloss_ja: '受身',
    gloss_en: 'passive-neutral',
    cognitive_effect: '行為者を背景化して被動作主を主語化',
    triggers: [
      { surface: 'られる',   scope: 'verbal-suffix' },
      { surface: 'られた',   scope: 'verbal-suffix' },
      { surface: 'られて',   scope: 'verbal-suffix' },
      { surface: 'される',   scope: 'verbal-suffix' },
      { surface: 'された',   scope: 'verbal-suffix' },
      { surface: 'されて',   scope: 'verbal-suffix' },
      { surface: 'れる',     scope: 'verbal-suffix', not_after: ['く','ら','せ'] },
    ],
    priority: 2,
  },

  // =========================================================
  // 21. UNIVERSAL / EXEMPLIFICATION
  // =========================================================
  {
    id: 'UNIVERSAL-CLAIM',
    category: 'quantification.universal',
    gloss_ja: '普遍主張',
    gloss_en: 'universal-claim',
    cognitive_effect: '「〜を問わない／〜にかかわらず」で例外なく適用と主張',
    triggers: [
      { surface: 'を問わない',   scope: 'anywhere' },
      { surface: 'を問わず',     scope: 'anywhere' },
      { surface: 'にかかわらず', scope: 'anywhere' },
      { surface: 'に関わらず',   scope: 'anywhere' },
      { surface: 'を問わなくて', scope: 'anywhere' },
    ],
    priority: 8,
  },
  {
    id: 'NON-EXHAUSTIVE-EXEMPLIFY',
    category: 'quantification.non-exhaustive',
    gloss_ja: '非網羅例示',
    gloss_en: 'non-exhaustive-exemplify',
    cognitive_effect: '「〜たりする」で「これ以外にもある」と暗示',
    triggers: [
      { surface: 'たりする',   scope: 'anywhere' },
      { surface: 'たりします', scope: 'sentence-final' },
      { surface: 'たりした',   scope: 'anywhere' },
      { surface: 'たりしました', scope: 'sentence-final' },
      { surface: 'たりして',   scope: 'anywhere' },
      { surface: 'だったり',   scope: 'anywhere' },
    ],
    priority: 6,
  },

  // =========================================================
  // 22. FRAMING-AS / CRITERION-SETTING / META-DISCOURSE-REF
  // =========================================================
  {
    id: 'FRAMING-AS',
    category: 'nominalization.framing',
    gloss_ja: '〜として',
    gloss_en: 'framing-as',
    cognitive_effect: '対象に「〜として」の役割枠を被せて評価',
    triggers: [
      { surface: 'としては', scope: 'after-noun' },
      { surface: 'としても', scope: 'after-noun' },
      { surface: 'として',   scope: 'after-noun' },
    ],
    priority: 6,
  },
  {
    id: 'CRITERION-SETTING',
    category: 'discourse.criterion',
    gloss_ja: '基準設定',
    gloss_en: 'criterion-setting',
    cognitive_effect: '「〜で言えば／からすると」で評価基準を明示',
    triggers: [
      { surface: 'で言えば',     scope: 'after-noun' },
      { surface: 'で言うと',     scope: 'after-noun' },
      { surface: 'で言いますと', scope: 'after-noun' },
      { surface: 'からすると',   scope: 'after-noun' },
      { surface: 'からすれば',   scope: 'after-noun' },
      { surface: '的に言えば',   scope: 'after-noun' },
      { surface: '的に言うと',   scope: 'after-noun' },
    ],
    priority: 6,
  },
  {
    id: 'META-SEGUE',
    category: 'meta.segue',
    gloss_ja: 'メタ転換',
    gloss_en: 'meta-segue',
    cognitive_effect: '前段を結論受けして次の話題へ移行 — 完結したメタ枠',
    triggers: [
      { surface: 'というわけで',   scope: 'sentence-initial' },
      { surface: 'そんなわけで',   scope: 'sentence-initial' },
      { surface: 'そういうわけで', scope: 'sentence-initial' },
      { surface: 'ってわけで',     scope: 'sentence-initial' },
    ],
    closes_span: 'quotative',
    priority: 9,
  },
  // =========================================================
  //  reason-frame 構文族 — 「わけ」= 共有推論枠 (shared inference frame)
  // ---------------------------------------------------------
  //  原理 (ユーザ診断): 「わけ」単体は終端でなく「聴き手も辿れる道理
  //  として命題を差し出す」枠マーカー。意味の本体は わけ + 後接辞 の *積*。
  //  後接辞が枠を別々の MOVE へ操舵し、各々が話者-聴者の認識的関係を露わにする:
  //    で(して)  → 継起足場 (未完・次節への踏み台)
  //    だから     → 因果前提化 (明示的に前提へ据える)
  //    だけど     → 留保・捻り / 結論→話題転換
  //    ですよ/だよ → 開示・押し出し (語りの山場)
  //    ですね/だね → 整合要請 (聴き手と摺り合わせ)
  //    です/だ    → 素の道理提示 (中立)
  //  旧 LOGICAL-CONCLUDE が全形を「必然帰結/反論封じ」(議論モデル) に潰し、
  //  語りレジスタの推進機能と関係情報を消していた。family で構成性を回復。
  //  interaction_hint は転換B の既存 act へ写像 (新 act は作らない)。
  // =========================================================
  {
    id: 'REASON-GROUND',
    category: 'meta.reason-frame',
    family: 'reason-frame',
    gloss_ja: '道理→足場',
    gloss_en: 'reason-ground',
    cognitive_effect: '「〜わけで(して)」道理を立てて次節への足場にする — 未完・継起',
    interaction_hint: 'INFORM',
    triggers: [
      { surface: 'わけでして',     scope: 'clause-final' },
      { surface: 'わけでありまして', scope: 'clause-final' },
      { surface: 'わけで',         scope: 'clause-final' },
    ],
    priority: 8,
  },
  {
    id: 'REASON-CAUSE',
    category: 'meta.reason-frame',
    family: 'reason-frame',
    gloss_ja: '道理→前提',
    gloss_en: 'reason-cause',
    cognitive_effect: '「〜わけだから」道理を明示的前提として因果の土台に据える',
    interaction_hint: 'GROUND-CLAIM',
    triggers: [
      { surface: 'わけですから', scope: 'clause-final' },
      { surface: 'わけだから',   scope: 'clause-final' },
    ],
    priority: 8,
  },
  {
    id: 'REASON-CONCEDE',
    category: 'meta.reason-frame',
    family: 'reason-frame',
    gloss_ja: '道理→留保/転換',
    gloss_en: 'reason-concede',
    cognitive_effect: '「〜わけだけど／わけですけど」道理を一旦立て、留保・捻り・話題転換へ転じる',
    interaction_hint: 'GROUND-CLAIM',
    triggers: [
      { surface: 'わけですけれども', scope: 'clause-final' },
      { surface: 'わけですけども',   scope: 'clause-final' },
      { surface: 'わけですけれど',   scope: 'clause-final' },
      { surface: 'わけですけど',     scope: 'clause-final' },
      { surface: 'わけだけれども',   scope: 'clause-final' },
      { surface: 'わけだけども',     scope: 'clause-final' },
      { surface: 'わけだけれど',     scope: 'clause-final' },
      { surface: 'わけだけど',       scope: 'clause-final' },
    ],
    priority: 8,
  },
  {
    id: 'REASON-REVEAL',
    category: 'meta.reason-frame',
    family: 'reason-frame',
    gloss_ja: '道理→開示',
    gloss_en: 'reason-reveal',
    cognitive_effect: '「〜わけですよ／わけだよ」道理として聴き手に押し出す・開示 — 語りの山場',
    interaction_hint: 'INFORM',
    triggers: [
      { surface: 'わけですよ', scope: 'sentence-final' },
      { surface: 'わけだよ',   scope: 'sentence-final' },
    ],
    priority: 8,
  },
  {
    id: 'REASON-ALIGN',
    category: 'meta.reason-frame',
    family: 'reason-frame',
    gloss_ja: '道理→整合要請',
    gloss_en: 'reason-align',
    cognitive_effect: '「〜わけですね／わけだね」道理を聴き手と摺り合わせ整合を求める',
    interaction_hint: 'CONFIRM-SEEK',
    triggers: [
      { surface: 'わけですよね', scope: 'sentence-final' },
      { surface: 'わけだよね',   scope: 'sentence-final' },
      { surface: 'わけですね',   scope: 'sentence-final' },
      { surface: 'わけだね',     scope: 'sentence-final' },
    ],
    priority: 8,
  },
  {
    id: 'REASON-STATE',
    category: 'meta.reason-frame',
    family: 'reason-frame',
    gloss_ja: '道理提示',
    gloss_en: 'reason-state',
    cognitive_effect: '「〜わけです／わけだ」命題を聴き手も辿れる道理として中立に提示',
    interaction_hint: 'INFORM',
    triggers: [
      { surface: 'わけです', scope: 'sentence-final' },
      { surface: 'わけだ',   scope: 'sentence-final' },
    ],
    priority: 8,
  },
  {
    id: 'META-DISCOURSE-REF',
    category: 'meta.reference',
    gloss_ja: '言説指示',
    gloss_en: 'meta-discourse-ref',
    cognitive_effect: '「〜という話」で前段全体を1つの言説オブジェクトとして名詞化',
    triggers: [
      { surface: 'という話',     scope: 'after-clause' },
      { surface: 'って話',       scope: 'after-clause' },
      { surface: 'みたいな話',   scope: 'after-clause' },
      { surface: 'みたいなこと', scope: 'after-clause' },
    ],
    priority: 7,
  },
  {
    id: 'HYPOTHETICAL-WORLD-LABEL',
    category: 'conditional.world-label',
    gloss_ja: '仮想世界の名指し',
    gloss_en: 'hypothetical-world-label',
    cognitive_effect: '反事実的世界を「みたいな話／みたいな設計」で名詞オブジェクト化',
    triggers: [
      { surface: 'みたいな話',   scope: 'after-clause' },
      { surface: 'みたいなこと', scope: 'after-clause' },
      { surface: 'みたいな設計', scope: 'after-clause' },
      { surface: 'みたいな感じ', scope: 'after-clause' },
    ],
    priority: 7,
  },

  // =========================================================
  // 23. POSSESSIVE-MOTIVE
  // =========================================================
  {
    id: 'POSSESSIVE-MOTIVE',
    category: 'quotative.motive',
    gloss_ja: '動機の帰属',
    gloss_en: 'possessive-motive',
    cognitive_effect: '「Xの願い／意志／つもり」で人物に動機を帰属させる',
    triggers: [
      { surface: 'の願い',   scope: 'after-noun' },
      { surface: 'の意志',   scope: 'after-noun' },
      { surface: 'のつもり', scope: 'after-noun' },
      { surface: 'の気持ち', scope: 'after-noun' },
      { surface: 'の思い',   scope: 'after-noun' },
      { surface: 'の意図',   scope: 'after-noun' },
    ],
    priority: 6,
  },

  // =========================================================
  // 24. ADDITIVE / SCOPE-EXTEND
  // =========================================================
  {
    id: 'ADDITIVE-META',
    category: 'meta.additive',
    gloss_ja: '追加メタ',
    gloss_en: 'additive-meta',
    cognitive_effect: '「〜というのも」で別の言説要素も同列に追加',
    triggers: [
      { surface: 'というのも',   scope: 'after-clause' },
      { surface: 'っていうのも', scope: 'after-clause' },
    ],
    priority: 6,
  },
  {
    id: 'SCALAR-EVEN',
    category: 'quantification.scalar',
    gloss_ja: '極端例さえ',
    gloss_en: 'scalar-even',
    cognitive_effect: '極端な例を持ち出して主張の強さを上げる',
    triggers: [
      { surface: 'でさえ', scope: 'after-noun' },
      { surface: 'すら',   scope: 'after-noun' },
      { surface: 'さえ',   scope: 'after-noun' },
    ],
  },

  // =========================================================
  // 25. EXCLAMATIVES / DISCOVERY
  // =========================================================
  {
    id: 'EXCLAMATIVE-DISCOVERY',
    category: 'illocution.exclamative',
    gloss_ja: '気づき感嘆',
    gloss_en: 'exclamative-discovery',
    cognitive_effect: '新しい情報の発見・驚き反応を表明 — turn 内の認知更新を可視化',
    triggers: [
      { surface: 'あら、', scope: 'sentence-initial' },
      { surface: 'あれ、', scope: 'sentence-initial' },
      { surface: 'おお、', scope: 'sentence-initial' },
      { surface: 'お、',   scope: 'sentence-initial' },
      { surface: 'え、',   scope: 'sentence-initial' },
      { surface: 'えっ、', scope: 'sentence-initial' },
      { surface: 'へえ、', scope: 'sentence-initial' },
      { surface: 'へー、', scope: 'sentence-initial' },
      { surface: 'ほー、', scope: 'sentence-initial' },
      { surface: 'おっと、', scope: 'sentence-initial' },
    ],
    priority: 7,
  },

  // =========================================================
  // 26. EXPLANATORY-Q
  // =========================================================
  {
    id: 'EXPLANATORY-Q',
    category: 'illocution.explanatory-q',
    gloss_ja: '説明要求疑問',
    gloss_en: 'explanatory-q',
    cognitive_effect: '「〜の?／〜んですか?」で背景説明を求める疑問',
    triggers: [
      { surface: 'のですか',   scope: 'sentence-final' },
      { surface: 'んですか',   scope: 'sentence-final' },
      { surface: 'んですか?',  scope: 'sentence-final' },
      { surface: 'んですか？', scope: 'sentence-final' },
      { surface: 'のかな',     scope: 'sentence-final' },
      { surface: 'のか',       scope: 'sentence-final' },
      { surface: 'の?',        scope: 'sentence-final' },
      { surface: 'の？',       scope: 'sentence-final' },
    ],
    priority: 7,
  },

  // =========================================================
  // 27. META-CONFIRM
  // =========================================================
  {
    id: 'META-CONFIRM',
    category: 'meta.confirm',
    gloss_ja: 'メタ追認',
    gloss_en: 'meta-confirm',
    cognitive_effect: '「そうなんだけど」で相手の指摘を肯定しつつ反論枠を準備',
    triggers: [
      { surface: 'そうなんだけど',         scope: 'anywhere' },
      { surface: 'そうなんですけど',       scope: 'anywhere' },
      { surface: 'そうなんですけれども',   scope: 'anywhere' },
      { surface: 'そうなんだよね',         scope: 'sentence-final' },
      { surface: 'そうなんですよね',       scope: 'sentence-final' },
      { surface: 'そうなんですよ',         scope: 'sentence-final' },
      { surface: 'そうなんだよ',           scope: 'sentence-final' },
      { surface: 'そうなんです',           scope: 'sentence-final' },
      { surface: 'そうなんだ',             scope: 'sentence-final' },
    ],
    priority: 7,
  },

  // =========================================================
  // 28. TOPIC-INTRODUCE / TRAIL-OFF
  // =========================================================
  {
    id: 'TOPIC-INTRODUCE',
    category: 'topic.introduce',
    gloss_ja: '話題提示',
    gloss_en: 'topic-introduce',
    cognitive_effect: '「これね、／それね、」で次の話題対象を相手の注意に置く',
    triggers: [
      { surface: 'これね、',   scope: 'sentence-initial' },
      { surface: 'それね、',   scope: 'sentence-initial' },
      { surface: 'あれね、',   scope: 'sentence-initial' },
      { surface: 'これがね、', scope: 'sentence-initial' },
      { surface: 'それがね、', scope: 'sentence-initial' },
    ],
    priority: 7,
  },
  {
    id: 'TRAIL-OFF',
    category: 'illocution.trail-off',
    gloss_ja: '言いさし',
    gloss_en: 'trail-off',
    cognitive_effect: '文を完結せず「うん」「なんか」で切る → 自己中断・聞き手参画要請',
    triggers: [
      { regex: /、\s*うん。?$/,    scope: 'sentence-final' },
      { regex: /、\s*なんか。?$/,  scope: 'sentence-final' },
      { regex: /と\s*かね?。?$/,  scope: 'sentence-final' },
    ],
    priority: 4,
  },

  // =========================================================
  // 29. CHARACTER-ASCRIPTION / EVAL-NOMINALIZE
  // =========================================================
  {
    id: 'CHARACTER-ASCRIPTION',
    category: 'nominalization.character',
    gloss_ja: '人物特性化',
    gloss_en: 'character-ascription',
    cognitive_effect: '「Nであり」で対象に特性を並列付与',
    triggers: [
      { surface: 'であり',       scope: 'clause-final' },
      { surface: 'であって',     scope: 'clause-final' },
      { surface: 'でありながら', scope: 'clause-final' },
    ],
  },
  {
    id: 'EVAL-NOMINALIZE',
    category: 'nominalization.evaluation',
    gloss_ja: '評価名詞化',
    gloss_en: 'eval-nominalize',
    cognitive_effect: '「素晴らしいところ／いいところ」で評価軸付き名詞化',
    triggers: [
      { surface: '素晴らしいところ', scope: 'anywhere' },
      { surface: 'いいところ',       scope: 'anywhere' },
      { surface: '悪いところ',       scope: 'anywhere' },
      { surface: '面白いところ',     scope: 'anywhere' },
      { surface: '難しいところ',     scope: 'anywhere' },
    ],
  },

  // =========================================================
  // NEW (audit fix-list §9 item 5): seven missing high-frequency operators
  // =========================================================
  {
    id: 'TOPIC-STAGE-MARK',
    category: 'topic.stage-mark',
    gloss_ja: '段差し共有マーカー',
    gloss_en: 'topic-stage-mark',
    cognitive_effect: '節中で聴き手に「ここ受け取って」と段差しする',
    triggers: [
      { regex: /(?:は|が|も|を|に|で|って)ね[、，]/, scope: 'anywhere' },
      { regex: /(?:は|が|も|を|に|で|って)さ[、，]/, scope: 'anywhere' },
    ],
    priority: 3,
  },
  {
    id: 'EXCLUSIVE-LIMIT',
    category: 'quantification.exclusive',
    gloss_ja: '排他限定',
    gloss_en: 'exclusive-limit',
    cognitive_effect: '言及対象を排他的に制限し他の可能性を消す',
    triggers: [
      { regex: /しか[^。！？\n]{0,15}(?:ない|ません|なかった|ありません|あらず)/, scope: 'anywhere' },
      { regex: /っきゃ[^。！？\n]{0,8}ない/, scope: 'anywhere' },
      { surface: 'のみ',     scope: 'anywhere' },
      { surface: 'だけです', scope: 'sentence-final' },
      { surface: 'だけだ',   scope: 'sentence-final' },
      { surface: 'ばかりだ', scope: 'sentence-final' },
      { surface: 'ばかりです', scope: 'sentence-final' },
    ],
    priority: 6,
  },
  {
    id: 'EXCLAMATIVE-NOUN-FINAL',
    category: 'illocution.noun-exclamative',
    gloss_ja: '名詞文感嘆終止',
    gloss_en: 'exclamative-noun-final',
    cognitive_effect: '述語に名詞を充てて感嘆的に閉じる',
    triggers: [
      { regex: /[一-龥々ぁ-んァ-ヴー]こと[。．！]/, scope: 'sentence-final', requires_after_predicate: false },
      { regex: /[一-龥々ぁ-んァ-ヴー]もの[。．！]/, scope: 'sentence-final' },
    ],
    priority: 7,
  },
  {
    id: 'STRONG-AGREEMENT',
    category: 'illocution.strong-agree',
    gloss_ja: '強同意',
    gloss_en: 'strong-agreement',
    cognitive_effect: '相手命題を全面的に承認する',
    triggers: [
      { regex: /そう(?:そう){1,3}/,        scope: 'anywhere' },
      { regex: /うん(?:うん){1,3}/,        scope: 'anywhere' },
      { regex: /はい(?:はい){1,3}/,        scope: 'anywhere' },
      { surface: 'その通り',           scope: 'anywhere' },
      { surface: 'そのとおり',         scope: 'anywhere' },
      { surface: 'まさに',             scope: 'anywhere' },
      { surface: 'まさしく',           scope: 'anywhere' },
      { surface: 'おっしゃる通り',     scope: 'anywhere' },
      { surface: 'おっしゃるとおり',   scope: 'anywhere' },
      { surface: 'その通りです',         scope: 'anywhere' },
      { surface: '確かに',             scope: 'anywhere' },
    ],
    priority: 7,
  },
  {
    id: 'SOLILOQUY-NA',
    category: 'illocution.soliloquy',
    gloss_ja: '独語的評価',
    gloss_en: 'soliloquy-na',
    cognitive_effect: '聞き手不在的に自己評価をつぶやく',
    triggers: [
      { regex: /(?:いい|すごい|やばい|難しい|面白い|嬉しい|悲しい|きつい|ひどい|怖い|つらい|楽|大変|無理|だ|だっ)な[。．]?$/, scope: 'sentence-final' },
    ],
    priority: 6,
  },
  {
    id: 'RIGHT-DISLOCATION',
    category: 'syntax.right-dislocation',
    gloss_ja: '右方転位',
    gloss_en: 'right-dislocation',
    cognitive_effect: '述語後に名詞句を付け足して焦点を再指示',
    triggers: [
      // predicate-final morpheme + comma + short NP (≤5 chars) at sentence end
      { regex: /(?:だ|だよ|だね|でしょう|です|ですね|ですよ|ます|ますね|ました|た|る|よね|よ|ね)[、，][一-鿿ぁ-んァ-ヴー]{1,6}[。．！？]?$/, scope: 'sentence-final' },
    ],
    priority: 5,
  },
  {
    id: 'DANGLING-CAUSAL',
    category: 'causal.dangling',
    gloss_ja: '言い差し因果',
    gloss_en: 'dangling-causal',
    cognitive_effect: '因果節だけ提示し、帰結を聞き手に推論させて閉じる',
    triggers: [
      { surface: 'だから。',     scope: 'sentence-final' },
      { surface: 'だからね。',   scope: 'sentence-final' },
      { surface: 'からね。',     scope: 'sentence-final' },
      { surface: 'からなあ。',   scope: 'sentence-final' },
      { surface: 'んだから。',   scope: 'sentence-final' },
      { surface: 'なんだから。', scope: 'sentence-final' },
    ],
    priority: 8,
  },

  // =========================================================
  // 11. INTERIOR/EXTERIOR DISCOURSE EXTENSION (kant transcript audit)
  // ---------------------------------------------------------
  // 内側=話者内部の思考流路、外側=発話化された談話面。
  // op に `thoughtLayer` 属性を付け、thought.mjs で文脈補正する。
  // 命名原則: 表層トリガーではなく **機能** から op 名を起こす。
  // =========================================================
  {
    id: 'MUSING-MODAL',
    category: 'modality.musing',
    gloss_ja: '内省的弱断定',
    gloss_en: 'musing-modal',
    cognitive_effect: '内面の印象を試験的に提示し、聞き手に強い承認を求めない。EPISTEMIC-MAY が「客観確率」なのに対し、こちらは「主観的曖昧さ」の宣言。',
    thoughtLayer: 'interior.musing',
    triggers: [
      { regex: /(?:な|い|る|た|だ)よう?な気がし(?:て|ます|た)/, scope: 'anywhere' },
      { regex: /気がし(?:ます|た|て(?:いる|る))/,                scope: 'anywhere' },
      { regex: /のかな(?:って|と|、)/,                            scope: 'anywhere' },
      { regex: /かな(?:って思|と思)/,                              scope: 'anywhere' },
      { surface: 'なのかなって',     scope: 'anywhere' },
    ],
    priority: 7,
  },
  {
    id: 'POTENTIAL-PERMISSION',
    category: 'modality.potential-admit',
    gloss_ja: '可能性承認',
    gloss_en: 'potential-permission',
    cognitive_effect: '事実主張ではなく「可能性の余地を認める」評定モード。倫理談話で「足りうる/ありうる」として頻出。',
    thoughtLayer: 'interior.verdict',
    triggers: [
      { regex: /足り(?:う|得)る/,   scope: 'anywhere' },
      { regex: /あり(?:う|得)る/,   scope: 'anywhere' },
      { regex: /なり(?:う|得)る/,   scope: 'anywhere' },
      { regex: /(?:でき|で?しょ?う)?(?:う|得)る(?:と|の|か)/, scope: 'anywhere' },
    ],
    priority: 7,
  },
  {
    id: 'CONVICTION-CONDITIONAL',
    category: 'modality.conviction-cond',
    gloss_ja: '確信条件',
    gloss_en: 'conviction-conditional',
    cognitive_effect: '「確信できれば〜である」型 → 評定の効力を「内面の確信状態」に条件付ける。倫理判断を主観的内面状態に媒介させる装置。',
    thoughtLayer: 'interior.world-build',
    triggers: [
      { regex: /確信(?:が)?でき(?:るので|るのであれば|れば|るなら)/, scope: 'anywhere' },
      { surface: 'と確信ができるのであれば', scope: 'anywhere' },
      { surface: 'と確信できるなら',         scope: 'anywhere' },
    ],
    priority: 8,
  },
  {
    id: 'DEEPEN-PROBE-OPEN',
    category: 'discourse.deepen-probe',
    gloss_ja: '探究深化開始',
    gloss_en: 'deepen-probe-open',
    cognitive_effect: '同じ話題に「もう一段深い問い」を重ねる教師ムーブ。話題を維持しつつ評価軸を深く再設定する。',
    thoughtLayer: 'exterior.frame-mark',
    triggers: [
      { surface: 'もうちょっと踏み込んで', scope: 'anywhere' },
      { surface: '踏み込んで言うと',       scope: 'anywhere' },
      { surface: 'もう一歩進んで',         scope: 'anywhere' },
      { surface: '突っ込んで言うと',       scope: 'anywhere' },
      { surface: 'さらに踏み込んで',       scope: 'anywhere' },
    ],
    priority: 8,
  },
  {
    id: 'TOPIC-PIVOT-MARK',
    category: 'discourse.topic-pivot',
    gloss_ja: '話題ピボット明示',
    gloss_en: 'topic-pivot-mark',
    cognitive_effect: '同じ枠(試問/対話)内で話題だけ意図的に切り替える宣言。FRAME-PIVOT が「視点の回転」なのに対し、こちらは「対象の入れ替え」。',
    thoughtLayer: 'exterior.frame-mark',
    triggers: [
      { surface: 'ちょっと話を変える',   scope: 'anywhere' },
      { surface: 'ちょっと問いを変える', scope: 'anywhere' },
      { surface: '話を変えると',         scope: 'anywhere' },
      { surface: '話を変えて',           scope: 'anywhere' },
      { surface: '別の話題',             scope: 'anywhere' },
    ],
    priority: 8,
  },
  {
    id: 'STRATEGIC-CALCULUS',
    category: 'frame.strategic',
    gloss_ja: '戦略計算枠',
    gloss_en: 'strategic-calculus',
    cognitive_effect: '損得・自利・利己といった「戦略的計算」を談話の評価軸として持ち込む。倫理談話においては道徳的善の対極を提示する装置。',
    thoughtLayer: 'interior.world-build',
    triggers: [
      { regex: /(?:した|する|やった|やる)方が(?:後で|きっと|絶対|本当に)?得/, scope: 'anywhere' },
      { surface: '自利的',         scope: 'anywhere' },
      { surface: '利己的',         scope: 'anywhere' },
      { surface: '損得',           scope: 'anywhere' },
      { surface: '得だから',       scope: 'anywhere' },
      { surface: '得である',       scope: 'anywhere' },
      { regex: /(?:後で|あとで)得/, scope: 'anywhere' },
    ],
    priority: 7,
  },
  {
    id: 'GENRE-CITATION',
    category: 'discourse.genre-cite',
    gloss_ja: 'ジャンル引照',
    gloss_en: 'genre-citation',
    cognitive_effect: '「韓流ドラマでよくある」「典型的」など、共有文化規範を引照して説明枠を一気に節約する。聞き手と前提共有を強制する。',
    thoughtLayer: 'exterior.meta',
    triggers: [
      { regex: /(?:に|で)よくある(?:話|設定|シーン|展開|パターン)/, scope: 'anywhere' },
      { surface: '典型的',     scope: 'anywhere' },
      { surface: '定番',       scope: 'anywhere' },
      { surface: 'お決まりの', scope: 'anywhere' },
    ],
    priority: 7,
  },
  {
    id: 'EXAM-FRAME-MARK',
    category: 'discourse.exam-frame',
    gloss_ja: '試問フレーム標',
    gloss_en: 'exam-frame-mark',
    cognitive_effect: '会話を「教師→生徒の試問」モードに切り替える。「テストだ/第N問/クリア」等で評価-合否枠を顕在化させる。',
    thoughtLayer: 'exterior.frame-mark',
    triggers: [
      { regex: /第[一二三四五六七八九十0-9０-９]+問/, scope: 'anywhere' },
      { surface: 'テストだ',         scope: 'anywhere' },
      { surface: 'クリアぐらい',     scope: 'anywhere' },
      { surface: 'クリアです',       scope: 'anywhere' },
      { surface: '試験モード',       scope: 'anywhere' },
    ],
    priority: 7,
  },
  {
    id: 'RELIEF-EXCLAIM',
    category: 'illocution.relief',
    gloss_ja: '安堵感嘆',
    gloss_en: 'relief-exclaim',
    cognitive_effect: '直前の対話展開が自分にとって脅威でなくなったことを表明する meta-感情。フィラーとは違い「会話の効果」への反応。',
    thoughtLayer: 'exterior.meta',
    triggers: [
      { surface: '危ねえ',   scope: 'anywhere' },
      { surface: '危なかった', scope: 'anywhere' },
      { surface: '助けて',   scope: 'anywhere' },
      { regex: /(?:あ、|ああ、)?よかった/, scope: 'anywhere' },
      { surface: 'セーフ',   scope: 'anywhere' },
    ],
    priority: 6,
  },
  {
    id: 'COUNTERFACTUAL-IDENTIFY',
    category: 'frame.counterfactual',
    gloss_ja: '反事実同定',
    gloss_en: 'counterfactual-identify',
    cognitive_effect: '対象を「もしXだと判明したら」の反事実下で再同定する。隠れた属性の発覚を仮構し評価を再起動する。',
    thoughtLayer: 'interior.world-build',
    triggers: [
      { regex: /(?:だ|だっ?て)分かった場合(?:とか|だけ|なら)?/,           scope: 'anywhere' },
      { regex: /だと(?:分かっている|判明した|知った)場合(?:とか|だけ|なら)?/, scope: 'anywhere' },
      { regex: /って分かった場合(?:とか|だけ|なら)?/,                   scope: 'anywhere' },
      { regex: /と分かった場合(?:とか|だけ|なら)?/,                     scope: 'anywhere' },
    ],
    priority: 8,
  },
  {
    id: 'UNDERSTANDING-REPORT',
    category: 'illocution.understand-report',
    gloss_ja: '理解報告',
    gloss_en: 'understanding-report',
    cognitive_effect: '直前まで述べた内容を「自分の現在の理解」として閉じ、相手の評価を待つ。学習者特有の自己定位ムーブ。',
    thoughtLayer: 'exterior.address',
    triggers: [
      { surface: 'っていう理解です', scope: 'sentence-final' },
      { surface: 'という認識です',   scope: 'sentence-final' },
      { surface: 'と理解しています', scope: 'sentence-final' },
    ],
    priority: 8,
  },
  {
    id: 'UNDERSTANDING-CHECK',
    category: 'illocution.understand-check',
    gloss_ja: '理解照合要求',
    gloss_en: 'understanding-check',
    cognitive_effect: '自分の理解が正しいか相手に判定してもらう明示的要請。学習者→教師方向の合意取り。',
    thoughtLayer: 'exterior.address',
    triggers: [
      { regex: /(?:今の|私の|僕の|自分の)理解(?:は|で)?(?:良かった|合っ|大丈夫|よろしい)/, scope: 'anywhere' },
      { regex: /(?:良かった|合って|大丈夫)(?:ですか|でしょうか|でした[かが])[\s、。]*(?:今の|私の|僕の|自分の)?(?:今の)?(?:理解|認識)(?:は|で)?[？?]?/, scope: 'anywhere' },
      { surface: '理解で合ってますか',     scope: 'anywhere' },
      { surface: '今の理解で',             scope: 'anywhere' },
      { surface: 'で合ってますか',         scope: 'anywhere' },
    ],
    priority: 8,
  },
  {
    id: 'META-CONVERSATIONAL-EFFECT',
    category: 'discourse.meta-effect',
    gloss_ja: '会話影響メタ',
    gloss_en: 'meta-conversational-effect',
    cognitive_effect: '直前発話が自分の行動可能性に与えた影響を会話自体への論評として返す。第三項的メタ位置取り。',
    thoughtLayer: 'exterior.meta',
    triggers: [
      { surface: '言われちゃったらもう', scope: 'anywhere' },
      { surface: '言われたらもう',       scope: 'anywhere' },
      { regex: /言われ(?:ちゃっ)?たら(?:もう|さすがに)/, scope: 'anywhere' },
    ],
    priority: 7,
  },
];

/** Total operator count for sanity reporting. */
export const OPERATOR_COUNT = OPERATORS.length;

/** Total trigger count for sanity reporting. */
export const TRIGGER_COUNT = OPERATORS.reduce((n, op) => n + op.triggers.length, 0);

/** Lookup: operator id → operator. */
export const OP_BY_ID = new Map(OPERATORS.map(o => [o.id, o]));

/** Flat list of (operator, trigger) pairs for the matcher, ordered by
 *  descending priority then descending surface length.
 *  Discourse-layer operators (layer:'d') are excluded — they have no
 *  surface triggers and are derived in relations.mjs. */
export const TRIGGER_INDEX = (() => {
  /** @type {{op:Operator, trig:Trigger, key:string}[]} */
  const flat = [];
  for (const op of OPERATORS) {
    if (op.layer === 'd') continue;
    for (const t of op.triggers) {
      flat.push({ op, trig: t, key: t.surface ?? String(t.regex) });
    }
  }
  flat.sort((a, b) => {
    const pa = a.op.priority ?? 0, pb = b.op.priority ?? 0;
    if (pa !== pb) return pb - pa;
    const la = a.trig.surface?.length ?? 0;
    const lb = b.trig.surface?.length ?? 0;
    return lb - la;
  });
  return flat;
})();
