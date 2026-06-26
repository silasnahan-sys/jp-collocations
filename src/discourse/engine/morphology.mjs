// _tmp_pipeline/morphology.mjs
// =====================================================================
// 形態素辞書 (MORPHOLOGY) — 構成性原則の土台
// ---------------------------------------------------------------------
// 各形態素は単独で「文法的役割」と「典型的に何を担うか」を持つ。
// しかしその最終効果は周辺要素との合成で初めて決まる。本辞書は op の
// 表面文字列を「機能を持つ部品」に割って見せるための語彙基底である。
//
// 注意:
//   - これは語彙意味論ではなく **談話機能** の辞書である。
//     例: 「って」は引用助詞だが、本辞書では「前部命題を引用化して
//          話題化/評価対象化する」という談話寄与で記述する。
//   - 一つの形態素が複数文脈で異なる役割を担う場合、配列で並べて
//     compose.mjs 側が周辺要素を見て選ぶ。
//   - role 名は SCREAMING-KEBAB-CASE で安定識別子として使う。
// =====================================================================

/**
 * @typedef {{
 *   morph: string,          // 表面形
 *   role: string,           // 機能役割の安定 id
 *   contributes_ja: string, // この場で何を担うか(日本語)
 *   contextual?: boolean,   // true なら文脈で役割が変わりうる
 *   licenses?: string[],    // この役割が許可する後続役割
 * }} MorphEntry
 */

/** @type {MorphEntry[]} */
export const MORPH_ENTRIES = [
  // ---------- 引用/メタ化 ----------
  { morph: 'って',     role: 'QUOTATIVE-MARKER', contributes_ja: '前部命題を引用化し評価対象として持ち上げる' },
  { morph: 'と',       role: 'QUOTATIVE-MARKER', contributes_ja: '直前命題を引用枠に入れる', contextual: true },
  { morph: 'という',   role: 'QUOTATIVE-NOMINAL', contributes_ja: '引用句を名詞修飾化して「〜という X」型に組み込む' },
  { morph: 'っていう', role: 'QUOTATIVE-NOMINAL', contributes_ja: '引用句を名詞修飾化(口語形)' },

  // ---------- 認識動詞 ----------
  { morph: '分かっ',   role: 'COGNITION-VERB',   contributes_ja: '認識成立(知覚→確定)を担う動詞語幹' },
  { morph: '分かる',   role: 'COGNITION-VERB',   contributes_ja: '認識可能性/成立を担う' },
  { morph: '思っ',     role: 'BELIEF-VERB',      contributes_ja: '主観的信念の表出を担う動詞語幹' },
  { morph: '思う',     role: 'BELIEF-VERB',      contributes_ja: '主観的信念の表出' },
  { morph: '思い',     role: 'BELIEF-VERB',      contributes_ja: '主観的信念の表出(連用形)' },
  { morph: '言わ',     role: 'SAY-VERB-PASSIVE-STEM', contributes_ja: '発話動詞の受動語幹(誰かが私に言った→私が言われた)' },
  { morph: '言われ',   role: 'SAY-VERB-PASSIVE', contributes_ja: '他者発話を受け取った経験を表す受動形' },
  { morph: '言う',     role: 'SAY-VERB',         contributes_ja: '発話行為を表す' },
  { morph: '気がし',   role: 'PERCEPTION-VERB-WEAK', contributes_ja: '弱い直観的印象を表出する慣用動詞句' },
  { morph: '感じ',     role: 'PERCEPTION-VERB',  contributes_ja: '感覚/印象の成立を担う' },
  { morph: '見え',     role: 'EVIDENTIAL-VERB',  contributes_ja: '視覚証拠による判断を担う' },

  // ---------- 相 (aspect) / 時制 ----------
  { morph: 'た',       role: 'PERFECTIVE',       contributes_ja: '完了相を付与し事象を確定済みとして提示', contextual: true },
  { morph: 'てる',     role: 'PROGRESSIVE',      contributes_ja: '進行/結果状態を付与' },
  { morph: 'ている',   role: 'PROGRESSIVE',      contributes_ja: '進行/結果状態を付与(書言葉形)' },
  { morph: 'ちゃっ',   role: 'COMPLETIVE-NEGATIVE-AFFECT', contributes_ja: '完了 + 不本意/負価評価を同時に付与(〜てしまった の短縮)' },
  { morph: 'ちゃう',   role: 'COMPLETIVE-NEGATIVE-AFFECT', contributes_ja: '完了 + 不本意/負価評価' },

  // ---------- 受身/使役 ----------
  { morph: 'れる',     role: 'PASSIVE-OR-POTENTIAL', contributes_ja: '受動 ∨ 可能 ∨ 自発(文脈依存)', contextual: true },
  { morph: 'られる',   role: 'PASSIVE-OR-POTENTIAL', contributes_ja: '受動 ∨ 可能 ∨ 自発(文脈依存)', contextual: true },
  { morph: 'させ',     role: 'CAUSATIVE',        contributes_ja: '使役関係を導入' },

  // ---------- 条件枠 ----------
  { morph: 'たら',     role: 'CONDITIONAL-PERFECTIVE', contributes_ja: '完了型条件節を開く(P したら Q)' },
  { morph: 'れば',     role: 'CONDITIONAL-PROVISIONAL', contributes_ja: '仮定的条件節を開く(P すれば Q)' },
  { morph: 'なら',     role: 'CONDITIONAL-TOPICAL', contributes_ja: '前提的/話題的条件節を開く(P なら Q)' },
  { morph: 'ば',       role: 'CONDITIONAL-PROVISIONAL', contributes_ja: '仮定条件節を開く' },
  { morph: 'もし',     role: 'HYPOTHETICAL-MARK', contributes_ja: '後続節を明示的に仮定として枠付ける' },
  { morph: '場合',     role: 'CONDITION-FRAME-NOUN', contributes_ja: '条件/状況枠を名詞として立てる(より分節的・分類的)' },
  { morph: '時',       role: 'TEMPORAL-FRAME-NOUN', contributes_ja: '時間/状況枠を名詞として立てる' },

  // ---------- 例示/列挙/緩和 ----------
  { morph: 'とか',     role: 'EXEMPLIFIER-HEDGE', contributes_ja: '一例として提示しつつ列挙未尽/断定回避を同時に付与', contextual: true },
  { morph: 'なんか',   role: 'EXEMPLIFIER-DOWNGRADE', contributes_ja: '一例提示 + 価値の引き下げ(自嘲/謙遜の余地)' },
  { morph: 'みたいな', role: 'APPROXIMATIVE-QUOTE', contributes_ja: '直前を「〜のような」性質として近似引用化' },
  { morph: 'ような',   role: 'APPROXIMATIVE-ADNOMINAL', contributes_ja: '近似/類比の連体修飾' },
  { morph: 'みたい',   role: 'APPROXIMATIVE',    contributes_ja: '近似/類比を担う' },
  { morph: 'よう',     role: 'APPROXIMATIVE-CORE', contributes_ja: '様態/近似の語幹' },
  { morph: '例えば',   role: 'EXEMPLIFY-MARK',   contributes_ja: '後続を例示として枠付ける' },

  // ---------- 列挙コミット / 順序標識 (Phase 6.1: 前方コミット primitive) ----------
  // 数量を先に宣言する「コミット数詞」。後続でこの数だけ項目を discharge する前方参照を開く。
  { morph: '二つ', role: 'ENUM-COUNT', contributes_ja: '列挙すべき項目数=2 を前方宣言' },
  { morph: '三つ', role: 'ENUM-COUNT', contributes_ja: '列挙すべき項目数=3 を前方宣言' },
  { morph: '四つ', role: 'ENUM-COUNT', contributes_ja: '列挙すべき項目数=4 を前方宣言' },
  { morph: '五つ', role: 'ENUM-COUNT', contributes_ja: '列挙すべき項目数=5 を前方宣言' },
  { morph: '六つ', role: 'ENUM-COUNT', contributes_ja: '列挙すべき項目数=6 を前方宣言' },
  { morph: '二点', role: 'ENUM-COUNT', contributes_ja: '論点数=2 を前方宣言' },
  { morph: '三点', role: 'ENUM-COUNT', contributes_ja: '論点数=3 を前方宣言' },
  { morph: '四点', role: 'ENUM-COUNT', contributes_ja: '論点数=4 を前方宣言' },
  // 順序標識 (discharge): 前方コミットの各 slot を埋める序数マーカー。
  { morph: 'まず',     role: 'ENUM-ORDINAL', contributes_ja: '列挙系列の先頭 slot を開く (序数=1)' },
  { morph: '最初に',   role: 'ENUM-ORDINAL', contributes_ja: '列挙系列の先頭 slot (序数=1)' },
  { morph: '最初は',   role: 'ENUM-ORDINAL', contributes_ja: '列挙系列の先頭 slot (序数=1, 対比含み)' },
  { morph: '一つ目',   role: 'ENUM-ORDINAL', contributes_ja: '列挙 slot 序数=1' },
  { morph: '二つ目',   role: 'ENUM-ORDINAL', contributes_ja: '列挙 slot 序数=2' },
  { morph: '三つ目',   role: 'ENUM-ORDINAL', contributes_ja: '列挙 slot 序数=3' },
  { morph: '四つ目',   role: 'ENUM-ORDINAL', contributes_ja: '列挙 slot 序数=4' },
  { morph: '五つ目',   role: 'ENUM-ORDINAL', contributes_ja: '列挙 slot 序数=5' },
  { morph: '第一',     role: 'ENUM-ORDINAL', contributes_ja: '列挙 slot 序数=1 (硬い)' },
  { morph: '第二',     role: 'ENUM-ORDINAL', contributes_ja: '列挙 slot 序数=2 (硬い)' },
  { morph: '第三',     role: 'ENUM-ORDINAL', contributes_ja: '列挙 slot 序数=3 (硬い)' },
  { morph: '次に',     role: 'ENUM-ORDINAL', contributes_ja: '列挙系列の次 slot (相対序数)' },
  { morph: '続いて',   role: 'ENUM-ORDINAL', contributes_ja: '列挙系列の次 slot (相対序数)' },
  { morph: '最後に',   role: 'ENUM-ORDINAL', contributes_ja: '列挙系列の最終 slot を閉じる' },
  { morph: '最後は',   role: 'ENUM-ORDINAL', contributes_ja: '列挙系列の最終 slot (対比含み)' },

  // ---------- 様態/モダリティ ----------
  { morph: 'かな',     role: 'EPISTEMIC-MUSE',   contributes_ja: '自問的低確信を付与(独り言寄り)' },
  { morph: 'かも',     role: 'EPISTEMIC-MAYBE',  contributes_ja: '可能性の低中度評価を付与' },
  { morph: 'だろう',   role: 'EPISTEMIC-CONJECTURE', contributes_ja: '推量を中庸確信で付与' },
  { morph: 'でしょう', role: 'EPISTEMIC-CONJECTURE-POLITE', contributes_ja: '推量(丁寧/対人的)' },
  { morph: 'はず',     role: 'EPISTEMIC-EXPECT', contributes_ja: '論理的当然性の期待を付与' },
  { morph: 'うる',     role: 'POTENTIAL-PERMIT', contributes_ja: '〜することが可能/許容と評価する潜在性付与' },
  { morph: 'える',     role: 'POTENTIAL-PERMIT', contributes_ja: '可能性付与' },
  { morph: 'できる',   role: 'POTENTIAL-ABILITY', contributes_ja: '実行可能性/能力を担う' },
  { morph: 'なきゃ',   role: 'OBLIGATION',       contributes_ja: '義務/必要性を負価条件として付与' },
  { morph: 'ねば',     role: 'OBLIGATION-FORMAL', contributes_ja: '義務(硬い)' },
  { morph: 'べき',     role: 'NORMATIVE',        contributes_ja: '規範的当為を付与' },

  // ---------- 副詞/談話標識 ----------
  { morph: 'もう',     role: 'DISCOURSE-RESIGNATION', contributes_ja: '時点完了 + 話者諦観/状況閉鎖を付与', contextual: true },
  { morph: 'やはり',   role: 'EXPECTATION-CONFIRM', contributes_ja: '事前予期と現実の一致を確認' },
  { morph: 'やっぱり', role: 'EXPECTATION-CONFIRM', contributes_ja: '事前予期と現実の一致を確認(口語)' },
  { morph: 'ちょっと', role: 'MITIGATOR',        contributes_ja: '行為強度/主張強度を一段下げる緩衝' },
  { morph: 'もうちょっと', role: 'INCREMENT-PROBE', contributes_ja: '段階的増分要求(さらに一歩進めるよう促す)' },
  { morph: '踏み込ん', role: 'DEEPEN-VERB',      contributes_ja: '抽象度/関与度の段階的増分を担う動詞語幹' },
  { morph: 'ほんとに', role: 'INTENSIFIER-EPISTEMIC', contributes_ja: '主張の真理度/強度を増幅' },
  { morph: '結局',     role: 'CLOSURE-MARK',     contributes_ja: '探索系列の終点を宣言' },
  { morph: 'つまり',   role: 'REFORMULATION-EQUIV', contributes_ja: '直前を等価別表現で言い換える' },
  { morph: 'なので',   role: 'CAUSAL-DISCOURSE', contributes_ja: '前部命題を根拠として後続を導く(談話レベル)' },
  { morph: 'だから',   role: 'CAUSAL-DERIVE',    contributes_ja: '前部から後続を結論として導く' },
  { morph: 'けど',     role: 'CONCESSIVE-OPEN',  contributes_ja: '逆接/留保の余地を後続に開く', contextual: true },
  { morph: 'けれども', role: 'CONCESSIVE-OPEN-FORMAL', contributes_ja: '逆接/留保(硬い)' },
  { morph: 'のに',     role: 'CONCESSIVE-COUNTER', contributes_ja: '期待裏切りの逆接を付与' },
  { morph: 'ね',       role: 'COMMON-GROUND-APPEAL', contributes_ja: '聴き手に共有確認を求める対人標識', contextual: true },
  { morph: 'よ',       role: 'INFORM-NEW',       contributes_ja: '聴き手未知情報の通知を担う対人標識' },
  { morph: 'な',       role: 'SELF-DIRECTED',    contributes_ja: '自己向け感慨/独白を担う' },
  { morph: 'さ',       role: 'CASUAL-ASSERT',    contributes_ja: '砕けた断言/聴き手注意喚起' },

  // ---------- 接続/留保 ----------
  { morph: 'んですけど', role: 'EXPLAIN-HEDGE-OPEN', contributes_ja: '説明モード + 後続留保で対話余地を開く' },
  { morph: 'んですが', role: 'EXPLAIN-HEDGE-FORMAL', contributes_ja: '説明モード + 留保(硬い)' },
  { morph: 'んです',   role: 'EXPLAIN-NOMINAL', contributes_ja: '説明モード(命題を背景化して理由/解説として提示)' },
  { morph: 'のです',   role: 'EXPLAIN-NOMINAL-FORMAL', contributes_ja: '説明モード(硬い)' },
  { morph: 'ので',     role: 'CAUSAL-DEPENDENT', contributes_ja: '前部を根拠として後続を導く(節レベル/客観寄り)' },
  { morph: 'から',     role: 'CAUSAL-DEPENDENT', contributes_ja: '前部を根拠として後続を導く(主観寄り)', contextual: true },

  // ---------- 話題転換/枠標 ----------
  { morph: '話を変える', role: 'TOPIC-SHIFT',    contributes_ja: '明示的話題転換を宣言' },
  { morph: '問いを変える', role: 'QUESTION-SHIFT', contributes_ja: '探索問題の入れ替えを宣言' },
  { morph: 'ちなみに', role: 'TANGENT-MARK',    contributes_ja: '副次情報への分岐を宣言' },
  { morph: 'ところで', role: 'TOPIC-PIVOT-FORMAL', contributes_ja: '話題転換(やや改まり)' },

  // ---------- 評価/感情 ----------
  { morph: '危ね',     role: 'AFFECT-RELIEF',    contributes_ja: '危機回避時の負価情動を表出' },
  { morph: '危ない',   role: 'AFFECT-RISK',      contributes_ja: '危険評価を表出' },
  { morph: 'よかった', role: 'AFFECT-RELIEF-POS', contributes_ja: '事態好転の安堵を表出' },
  { morph: 'まずい',   role: 'AFFECT-AVERSION',  contributes_ja: '事態悪化の評価を表出' },

  // ---------- 役割同定/特定 ----------
  { morph: '社長',     role: 'ROLE-NOUN',        contributes_ja: '社会的役割を持つ実体を立てる' },
  { morph: '老人',     role: 'PERSON-NOUN',      contributes_ja: '属性人物を立てる' },

  // ---------- 視座/談話準備 ----------
  // 「というのは / っていうのは」: の = 「(特定の) 一つの instance を指す代名詞」 (japanese.SE Q107594)
  //   → 直前内容を「**この一つの場面・このケース**」として取り上げる。話者に身近で具体的、
  //     しばしば話者自身 (または仮想話者) が言いそうな台詞として提示する口語的フレーム。
  { morph: 'というのは',   role: 'STAGE-OPEN-INSTANCE', contributes_ja: '視座導入: の=「(特定の) 一つの instance」 — 直前を身近・具体な「このケース」として取り上げる (口語/曖昧、話者に近い)' },
  { morph: 'っていうのは', role: 'STAGE-OPEN-INSTANCE', contributes_ja: '視座導入: の=「instance pronoun」 (口語形) — 直前を「このケース」として取り上げ、話者は内容を自分でも言いそうな具体例として提示' },

  // 「ということは / っていうことは」: こと = 「typed-fact (抽象事態)」(japanese.SE Q107594)
  //   → 直前内容を**抽象的命題/事実**として取り上げる。「人々の間で共有された一般事項」
  //     や「だとすれば〜」型の推論基盤としても機能。普遍的・距離的。
  { morph: 'ということは',   role: 'STAGE-OPEN-FACT', contributes_ja: '視座導入: こと=「typed 事実 (抽象命題)」 — 直前を普遍的事実/推論基盤として取り上げる (universal, 話者から距離)' },
  { morph: 'っていうことは', role: 'STAGE-OPEN-FACT', contributes_ja: '視座導入: こと=「typed 事実」(口語形) — 直前を抽象命題として取り上げ「だとすれば〜」の推論基盤に' },

  // 「というのも / っていうのも」: の=instance + も=also (japanese.SE Q38822)
  //   → 「この一例**もまた**」と追加列挙する視座導入。文末省略形では否定的判断の婉曲。
  { morph: 'というのも',   role: 'STAGE-OPEN-INSTANCE-ALSO', contributes_ja: '視座導入: の (instance) + も (also) — 「このケースもまた〜」 (文末省略時は否定的婉曲が多い)' },
  { morph: 'っていうのも', role: 'STAGE-OPEN-INSTANCE-ALSO', contributes_ja: '視座導入: の+も (口語) — 「これもまた」追加列挙 (文末省略形は否定的婉曲)' },

  // 「ということになっている」: 設定/合意された事実 (japanese.SE Q32387)
  //   → 「~という事として取り決められている」 (必ずしも真ではないが社会的/物語的に確定)
  { morph: 'ということになっている',   role: 'ESTABLISHED-CONVENTION-FRAME', contributes_ja: '取り決めフレーム: 「〜という事として人々の間で/物語上で設定されている」 (必ずしも事実ではない)' },
  { morph: 'っていうことになっている', role: 'ESTABLISHED-CONVENTION-FRAME', contributes_ja: '取り決めフレーム (口語形): 設定された事実扱い' },

  // 「っていうのかな / というのかな」: の(nominalizer) + か(疑問) + な(再帰) (japanese.SE Q84227)
  //   → 直前を要約し「〜とでも言おうか…」と**自分でも言葉を探しながら**ぼかす自己内対話。
  { morph: 'っていうのかな', role: 'WORDING-SEARCH-MUSE', contributes_ja: '語選びの自己内ぼかし: 「〜とでも言おうか/I wonder」 — 直前要約 + 言葉を探す自問' },
  { morph: 'というのかな',   role: 'WORDING-SEARCH-MUSE', contributes_ja: '語選びの自己内ぼかし (硬め)' },

  // ---------- Phase 6 追加: parser 骨格に必要な構造要素 (内容語リストではない) ----------
  // 格助詞/係助詞 — 構造境界の核
  { morph: 'が', role: 'NOM-PARTICLE',     contributes_ja: '主格を立てる', contextual: true },
  { morph: 'を', role: 'ACC-PARTICLE',     contributes_ja: '対格を立てる' },
  { morph: 'に', role: 'DAT-LOC-PARTICLE', contributes_ja: '与格/着点/状況', contextual: true },
  { morph: 'は', role: 'TOPIC-PARTICLE',   contributes_ja: '話題化/対比化', contextual: true },
  { morph: 'も', role: 'ALSO-PARTICLE',    contributes_ja: '追加/類比包含' },
  { morph: 'の', role: 'GENITIVE-NO',      contributes_ja: '属格/連体修飾/名詞化', contextual: true },
  { morph: 'や', role: 'LIST-OR-PARTICLE', contributes_ja: '列挙の選言' },
  { morph: 'か', role: 'INTERROG-PARTICLE', contributes_ja: '疑問化/選択化', contextual: true },
  // 一人称 (代名詞は構造的に「自己指示」の役割を持つ — 内容語でなく構造素)
  { morph: '僕',   role: 'FIRST-PERSON', contributes_ja: '一人称指示 (くだけ)' },
  { morph: '私',   role: 'FIRST-PERSON', contributes_ja: '一人称指示 (中立)' },
  { morph: '俺',   role: 'FIRST-PERSON', contributes_ja: '一人称指示 (粗野)' },
  { morph: '自分', role: 'FIRST-PERSON', contributes_ja: '一人称指示 / 再帰指示' },
  // 結論的評価 ending (推論の閉じ口)
  { morph: '方がいい',     role: 'CONCLUSIVE-EVAL', contributes_ja: '結論的評価「〜方がよい」' },
  { morph: 'ほうがいい',   role: 'CONCLUSIVE-EVAL', contributes_ja: '結論的評価「〜方がよい」' },
  { morph: '方がよい',     role: 'CONCLUSIVE-EVAL', contributes_ja: '結論的評価 (硬い)' },
  { morph: 'べきだ',       role: 'CONCLUSIVE-EVAL', contributes_ja: '規範的結論「〜べきだ」' },
  // 推論役 typing
  { morph: 'として',   role: 'REASONING-LINK', contributes_ja: '前項を「〜の役」として推論に組み込む' },
  { morph: 'によって', role: 'REASONING-LINK', contributes_ja: '前項を「〜による」として推論に組み込む' },
  // 名詞化詞 / 推論成果名詞
  { morph: 'こと', role: 'NOMINALIZER',   contributes_ja: '節を「こと」に reify' },
  { morph: '選択', role: 'REIFYING-NOUN', contributes_ja: '推論成果を「選択」として手渡す' },
  { morph: '判断', role: 'REIFYING-NOUN', contributes_ja: '推論成果を「判断」として手渡す' },
  { morph: '理解', role: 'REIFYING-NOUN', contributes_ja: '推論成果を「理解」として手渡す' },
  { morph: '結論', role: 'REIFYING-NOUN', contributes_ja: '推論成果を「結論」として手渡す' },
  { morph: '姿勢', role: 'REIFYING-NOUN', contributes_ja: '態度を「姿勢」として reify' },
  { morph: '考え方', role: 'REIFYING-NOUN', contributes_ja: '思考様式を reify' },
  // 確認 tag (聴き手志向)
  { morph: 'でしょ',         role: 'CONFIRM-TAG', contributes_ja: '聴き手承認求めの tag' },
  { morph: 'でしょう',       role: 'CONFIRM-TAG', contributes_ja: '聴き手承認求めの tag (硬い)' },
  { morph: 'じゃない',       role: 'CONFIRM-TAG', contributes_ja: '反問形による承認求め' },
  { morph: 'じゃないですか', role: 'CONFIRM-TAG', contributes_ja: '反問形 (丁寧) で承認求め' },
  { morph: 'よね', role: 'FINAL-PARTICLE-YONE', contributes_ja: '通知 + 共有確認の合成 tag' },
  // 主観副詞 (やっぱり 既存に追加注入 — alternates 経由)
  { morph: 'やっぱり', role: 'SUBJECTIVE-ADVERB', contributes_ja: '想像話者主観の立ち上がり (alt: EXPECTATION-CONFIRM)' },
  { morph: 'やはり',   role: 'SUBJECTIVE-ADVERB', contributes_ja: '想像話者主観の立ち上がり' },
  { morph: 'どうも',   role: 'SUBJECTIVE-ADVERB', contributes_ja: '主観判定の不確定性を立てる' },
  { morph: 'きっと',   role: 'SUBJECTIVE-ADVERB', contributes_ja: '主観確信を立てる' },
  { morph: 'なんとなく', role: 'SUBJECTIVE-ADVERB', contributes_ja: '主観の漠然性' },
  // 連体指示 (こうした / そういう 等)
  { morph: 'こうした', role: 'DEMONSTRATIVE-ADNOMINAL', contributes_ja: '想像話者視点で前述カテゴリを指す' },
  { morph: 'こういう', role: 'DEMONSTRATIVE-ADNOMINAL', contributes_ja: '前述/共有カテゴリの指示' },
  { morph: 'そういう', role: 'DEMONSTRATIVE-ADNOMINAL', contributes_ja: '前述カテゴリの指示' },
  { morph: 'あんな',   role: 'DEMONSTRATIVE-ADNOMINAL', contributes_ja: '遠隔指示' },
  // 説明モード兼 hedge
  { morph: 'と思う', role: 'BELIEF-VERB-CITE-SELF', contributes_ja: '自分の思考を引用化 (主張 + 自己距離化)' },
  { morph: '気がする', role: 'PERCEPTION-VERB-WEAK', contributes_ja: '弱い直観評価 (主張 + 距離化)' },
];

/** morph → entries(複数の文脈解釈を持ちうるので配列) */
export const MORPH_BY_SURFACE = (() => {
  /** @type {Map<string, MorphEntry[]>} */
  const m = new Map();
  for (const e of MORPH_ENTRIES) {
    if (!m.has(e.morph)) m.set(e.morph, []);
    m.get(e.morph).push(e);
  }
  return m;
})();

/** 長い形態素を優先する分解用ソート済み list。 */
export const MORPHS_BY_LENGTH = [...MORPH_ENTRIES]
  .map(e => e.morph)
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort((a, b) => b.length - a.length);

/**
 * 表面文字列を貪欲に左から最長一致で分解する。
 * 既知形態素にヒットしなければ 1 文字ずつ unknown として返す。
 * @param {string} surface
 * @returns {Array<{morph:string, role?:string, contributes_ja?:string, contextual?:boolean, unknown?:boolean}>}
 */
export function decomposeSurface(surface) {
  /** @type {Array<any>} */
  const out = [];
  let i = 0;
  let unknownBuf = '';
  const flushUnknown = () => {
    if (unknownBuf) {
      out.push({ morph: unknownBuf, unknown: true });
      unknownBuf = '';
    }
  };
  while (i < surface.length) {
    let matched = null;
    for (const m of MORPHS_BY_LENGTH) {
      if (i + m.length <= surface.length && surface.slice(i, i + m.length) === m) {
        matched = m;
        break;
      }
    }
    if (matched) {
      flushUnknown();
      const entries = MORPH_BY_SURFACE.get(matched) || [];
      // contextual な解釈は compose.mjs で解決。ここでは第一候補を載せる。
      const primary = entries[0];
      out.push({
        morph: matched,
        role: primary?.role,
        contributes_ja: primary?.contributes_ja,
        contextual: primary?.contextual === true,
        alternatives: entries.length > 1 ? entries.slice(1).map(e => ({ role: e.role, contributes_ja: e.contributes_ja })) : undefined,
      });
      i += matched.length;
    } else {
      unknownBuf += surface[i];
      i++;
    }
  }
  flushUnknown();
  return out;
}
