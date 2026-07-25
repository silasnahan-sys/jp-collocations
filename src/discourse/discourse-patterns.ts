/**
 * discourse-patterns.ts — Research-grade Japanese discourse grammar pattern database
 *
 * Union of ALL patterns from PRs #5, #6, #8, #9, #10, #11 plus extensive
 * additional linguistic research covering:
 *   - 会話分析 (Conversation Analysis)
 *   - 談話文法 (Discourse Grammar)
 *   - 語用論 (Pragmatics)
 *   - YouTube transcript-specific spoken patterns
 *   - コーパス言語学 (Corpus Linguistics) frequency insights
 *
 * 9 Categories (PR6 naming + PR9 metadata):
 *   A: 発話冒頭表現 (Utterance-Initial)
 *   B: 発話末表現 (Utterance-Final)
 *   C: 論理展開パターン (Logical Connectives)
 *   D: 談話境界標識 (Discourse Boundaries)
 *   E: 相互行為的表現 (Interactional)
 *   F: モダリティ (Modality)
 *   G: 引用・伝聞 (Quotation/Hearsay)
 *   H: テンス・アスペクト (Tense/Aspect)
 *   I: 待遇・レジスター (Politeness/Register)
 *
 * Each pattern stores pre-tokenized morpheme sequences for greedy
 * longest-first matching (PR6's approach) and full PR9 metadata.
 */

// ── Types ────────────────────────────────────────────────────

export type PatternCategory =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I'
  | 'J' | 'K' | 'L' | 'M' | 'N';

export type PatternPosition =
  | 'utterance-initial'
  | 'utterance-final'
  | 'mid-utterance'
  | 'boundary'
  | 'any';

export type PatternRegister =
  | 'casual'
  | 'neutral'
  | 'polite'
  | 'formal'
  | 'honorific'
  | 'humble'
  | 'slang'
  | 'academic'
  | 'any';

export type PragmaticFunction =
  | 'topic-initiation'
  | 'topic-shift'
  | 'topic-return'
  | 'topic-close'
  | 'sequence'
  | 'filler'
  | 'attention'
  | 'concession'
  | 'contrast'
  | 'cause'
  | 'result'
  | 'addition'
  | 'elaboration'
  | 'rephrasing'
  | 'summary'
  | 'hedge'
  | 'softening'
  | 'emphasis'
  | 'assertion'
  | 'confirmation-seeking'
  | 'agreement'
  | 'disagreement'
  | 'information-source'
  | 'evidential'
  | 'hearsay'
  | 'quotation'
  | 'desire'
  | 'obligation'
  | 'epistemic'
  | 'deontic'
  | 'dynamic'
  | 'progressive'
  | 'resultative'
  | 'completion'
  | 'preparation'
  | 'experience'
  | 'respect'
  | 'humility'
  | 'politeness'
  | 'self-repair'
  | 'other-repair'
  | 'backchannel'
  | 'turn-taking'
  | 'turn-yielding'
  | 'emotional'
  | 'surprise'
  | 'regret'
  // New pragmatic functions for expanded categories
  | 'tsukkomi'
  | 'boke'
  | 'reaction'
  | 'challenge'
  | 'rebuttal'
  | 'counter-example'
  | 'clarification-request'
  | 'explanation'
  | 'definition'
  | 'analogy'
  | 'comparison'
  | 'narration'
  | 'scene-setting'
  | 'evaluation'
  | 'self-deprecation'
  | 'empathy'
  | 'shared-knowledge'
  | 'topic-nomination'
  | 'digression'
  | 'return-from-digression'
  | 'stance-marking';

/**
 * Fine-grained relational role used by the discourse parser to compose
 * adjacency-pair rules. Distinct from {@link PragmaticFunction} which is
 * historically a flat tag — `discourseRole` carves out subdivisions that
 * matter for whether a relation should fire (e.g. `しかし` = `opposition`
 * vs `けど` = `weak-contrast`; both were `pragmaticFunction: 'contrast'`
 * but they pair with downstream sentences VERY differently).
 *
 * Roles are assigned by `discourse-roles.ts` as a post-process layer over
 * `ALL_PATTERNS`, so existing `P(...)` calls do not have to be rewritten.
 */
export type DiscourseRole =
  // Contrast / opposition family — split apart
  | 'opposition'          // しかし、でも、ところが、ではなく、いや: explicit semantic flip
  | 'weak-contrast'       // が、けど、けれども: often topic-shift / hedge, NOT real disagreement
  | 'concession'          // 確かに、もちろん、ただし、にしても: yields a point
  | 'qualification'       // ただ、もっとも: narrows / restricts
  // Causal family
  | 'cause'               // から、ので、なぜなら、というのは
  | 'consequence'         // そのため、その結果、従って、結局
  // Additive / sequencing
  | 'addition'            // しかも、さらに、その上、それに
  | 'sequence'            // まず、次に、それから、最後に
  // Elaboration family
  | 'elaboration'         // つまり、要するに、言い換えると
  | 'exemplification'     // 例えば、たとえば、いわば
  | 'summary'             // 結論から言うと、というわけで
  | 'rephrasing'          // つまり、というか、っていうか
  // Topic management
  | 'topic-shift'         // ところで、そういえば、さて、で
  | 'topic-return'        // 元の話に戻ると、で、さっきの
  | 'topic-initiation'    // そもそも、基本的に、前提として
  // Stance / modality
  | 'assertion-marker'    // んですよ、わけです、なんですよ
  | 'hedge'               // んですけど、かもしれない、と思う、なんとなく
  | 'evidential'          // らしい、みたい、そうだ
  | 'quotation'           // と、って、という
  // Interaction
  | 'interrogative-marker' // か、かな、でしょうか
  | 'agreement'            // そうそう、はいはい、わかる、たしかに
  | 'backchannel'          // うん、ああ、なるほど (light)
  | 'reaction'             // えー、うそ、まじ、やば (emotive reception)
  | 'disagreement'         // いや (when followed by counter)
  | 'repair'               // っていうか、じゃなくて、そうじゃなくて
  // Sentence-final speech-act-ish
  | 'request'              // てください、てくれ
  | 'obligation'           // べきだ、なきゃいけない
  | 'desire'               // たい、ほしい
  | 'filler'               // えー、あの、なんか (no relational role)
  | 'attention'            // ね、ねえ、ほら
  | 'other';

export interface DiscoursePatternDef {
  /** Unique ID: category letter + 3-digit number, e.g. "A001" */
  id: string;
  /** Surface form (how the pattern appears in text) */
  surface: string;
  /** Pre-tokenized morpheme sequence for matching */
  tokens: string[];
  category: PatternCategory;
  position: PatternPosition;
  register: PatternRegister;
  pragmaticFunction: PragmaticFunction;
  /**
   * Fine-grained relational role used by the discourse parser to combine
   * with sentence-level features when deciding adjacency-pair relations.
   * Filled in post-hoc by discourse-roles.ts (so existing P() calls don't
   * need to be touched). Undefined means "fall back to pragmaticFunction".
   */
  discourseRole?: DiscourseRole;
  /**
   * How strongly the marker commits to its role. `strong` markers can carry
   * a relation by themselves; `weak` markers need corroborating evidence.
   * E.g. しかし = strong opposition; けど = weak contrast.
   */
  roleStrength?: 'strong' | 'medium' | 'weak';
  /** IDs of patterns that frequently co-occur with this one */
  coOccurrence: string[];
  /** Japanese category label for display */
  categoryLabel: string;
  /** Japanese subcategory for finer grouping */
  subcategory: string;
  /** Brief Japanese-language explanation for learner display */
  gloss: string;
  /** English explanation */
  glossEn: string;
  /** Frequency tier: 1=very common in YT transcripts, 2=common, 3=occasional, 4=rare */
  frequencyTier: 1 | 2 | 3 | 4;
}

// ── Helper: build a pattern def with defaults ────────────────

let _counter: Record<string, number> = {};
function P(
  cat: PatternCategory,
  surface: string,
  tokens: string[],
  pos: PatternPosition,
  reg: PatternRegister,
  fn: PragmaticFunction,
  sub: string,
  gloss: string,
  glossEn: string,
  freq: 1 | 2 | 3 | 4,
  coOcc: string[] = [],
): DiscoursePatternDef {
  if (!_counter[cat]) _counter[cat] = 0;
  _counter[cat]++;
  const num = String(_counter[cat]).padStart(3, '0');
  const catLabels: Record<string, string> = {
    A: '発話冒頭表現', B: '発話末表現', C: '論理展開パターン',
    D: '談話境界標識', E: '相互行為的表現', F: 'モダリティ',
    G: '引用・伝聞', H: 'テンス・アスペクト', I: '待遇・レジスター',
    J: 'ツッコミ・反応', K: '討論パターン', L: '解説パターン',
    M: '雑談パターン', N: '複文構造連鎖',
  };
  return {
    id: `${cat}${num}`, surface, tokens, category: cat, position: pos,
    register: reg, pragmaticFunction: fn, coOccurrence: coOcc,
    categoryLabel: catLabels[cat], subcategory: sub, gloss, glossEn,
    frequencyTier: freq,
  };
}

// ══════════════════════════════════════════════════════════════
// CATEGORY A: 発話冒頭表現 (Utterance-Initial Markers)
// ══════════════════════════════════════════════════════════════

const CAT_A: DiscoursePatternDef[] = [
  // ── A.1 話題管理 (Topic Management) ─────────────────────
  P('A', '結局', ['結局'], 'utterance-initial', 'neutral', 'summary', '話題管理', '最終的な結論を導く', 'draws final conclusion', 1),
  P('A', '要するに', ['要するに'], 'utterance-initial', 'neutral', 'rephrasing', '話題管理', '内容を要約する', 'summarizes content', 1),
  P('A', 'つまり', ['つまり'], 'utterance-initial', 'neutral', 'rephrasing', '話題管理', '言い換え・要約', 'rephrases/summarizes', 1),
  P('A', '要は', ['要', 'は'], 'utterance-initial', 'casual', 'summary', '話題管理', 'ポイントを示す', 'indicates the point', 1),
  P('A', 'まとめると', ['まとめ', 'る', 'と'], 'utterance-initial', 'neutral', 'summary', '話題管理', '議論をまとめる', 'wraps up discussion', 2),
  P('A', '簡単に言うと', ['簡単', 'に', '言う', 'と'], 'utterance-initial', 'neutral', 'rephrasing', '話題管理', '平易に言い換える', 'simplifies expression', 2),
  P('A', '一言で言うと', ['一言', 'で', '言う', 'と'], 'utterance-initial', 'neutral', 'rephrasing', '話題管理', '一言で表す', 'says in one word', 3),
  P('A', '端的に言うと', ['端的', 'に', '言う', 'と'], 'utterance-initial', 'formal', 'rephrasing', '話題管理', '簡潔に述べる', 'states concisely', 3),

  // ── A.2 順序・叙述 (Sequence/Narrative) ──────────────────
  P('A', 'まず', ['まず'], 'utterance-initial', 'neutral', 'sequence', '順序・叙述', '最初の項目を示す', 'marks first item', 1),
  P('A', '次に', ['次', 'に'], 'utterance-initial', 'neutral', 'sequence', '順序・叙述', '次の項目を示す', 'marks next item', 2),
  P('A', 'それから', ['それから'], 'utterance-initial', 'neutral', 'sequence', '順序・叙述', '順序的に続ける', 'continues sequentially', 1),
  P('A', 'そしたら', ['そしたら'], 'utterance-initial', 'casual', 'sequence', '順序・叙述', '物語の展開', 'narrative development', 1),
  P('A', 'そしたらさ', ['そしたら', 'さ'], 'utterance-initial', 'casual', 'sequence', '順序・叙述', '物語展開＋注意喚起', 'narrative + attention', 1),
  P('A', 'で', ['で'], 'utterance-initial', 'casual', 'sequence', '順序・叙述', '会話を繋ぐ', 'casual connector', 1),
  P('A', 'それで', ['それ', 'で'], 'utterance-initial', 'neutral', 'result', '順序・叙述', '経緯を説明する', 'explains sequence', 1),
  P('A', 'じゃあ', ['じゃあ'], 'utterance-initial', 'casual', 'result', '順序・叙述', '前件を受けた帰結', 'consequent response', 1),
  P('A', 'じゃ', ['じゃ'], 'utterance-initial', 'casual', 'result', '順序・叙述', '短縮形「じゃあ」', 'shortened じゃあ', 1),
  P('A', 'そこで', ['そこ', 'で'], 'utterance-initial', 'neutral', 'result', '順序・叙述', '状況を受けて行動する', 'acts upon situation', 2),
  P('A', 'すると', ['する', 'と'], 'utterance-initial', 'neutral', 'result', '順序・叙述', '結果を導入する', 'introduces result', 2),
  P('A', 'そうすると', ['そう', 'する', 'と'], 'utterance-initial', 'neutral', 'result', '順序・叙述', '前提からの帰結', 'deduction from premise', 2),
  P('A', '1つ目は', ['1', 'つ', '目', 'は'], 'utterance-initial', 'neutral', 'sequence', '順序・叙述', '列挙の1番目', 'first in enumeration', 2),
  P('A', '2つ目は', ['2', 'つ', '目', 'は'], 'utterance-initial', 'neutral', 'sequence', '順序・叙述', '列挙の2番目', 'second in enumeration', 2),
  P('A', '1つはさ', ['1', 'つ', 'は', 'さ'], 'utterance-initial', 'casual', 'sequence', '順序・叙述', '証拠列挙の開始', 'starts evidence chain', 1, ['A028']),
  P('A', 'あともう1個', ['あと', 'もう', '1', '個'], 'utterance-initial', 'casual', 'sequence', '順序・叙述', '追加証拠を示す', 'adds another piece', 1, ['A027']),
  P('A', '最後に', ['最後', 'に'], 'utterance-initial', 'neutral', 'sequence', '順序・叙述', '最終項目を示す', 'marks final item', 2),

  // ── A.3 フィラー (Fillers/Hesitation) ────────────────────
  P('A', 'えーと', ['えーと'], 'utterance-initial', 'casual', 'filler', 'フィラー', '思考中の間合い', 'thinking pause', 1),
  P('A', 'えっと', ['えっと'], 'utterance-initial', 'casual', 'filler', 'フィラー', '思考中（短め）', 'brief thinking pause', 1),
  P('A', 'あのー', ['あのー'], 'utterance-initial', 'casual', 'filler', 'フィラー', '躊躇・言い淀み', 'hesitation filler', 1),
  P('A', 'あの', ['あの'], 'utterance-initial', 'casual', 'filler', 'フィラー', '躊躇（短め）', 'short hesitation', 1),
  P('A', 'なんか', ['なんか'], 'utterance-initial', 'casual', 'filler', 'フィラー', '曖昧化・ヘッジ', 'vague filler/hedge', 1),
  P('A', 'まあ', ['まあ'], 'utterance-initial', 'casual', 'softening', 'フィラー', '断言を和らげる', 'softens assertion', 1),
  P('A', 'うーん', ['うーん'], 'utterance-initial', 'casual', 'filler', 'フィラー', '考え中の応答', 'thinking response', 1),
  P('A', 'そのー', ['そのー'], 'utterance-initial', 'casual', 'filler', 'フィラー', '言い淀み', 'hesitation', 2),
  P('A', 'なんていうの', ['なんて', 'いう', 'の'], 'utterance-initial', 'casual', 'filler', 'フィラー', '言葉を探している', 'searching for words', 1),
  P('A', 'なんていうか', ['なんて', 'いう', 'か'], 'utterance-initial', 'casual', 'filler', 'フィラー', '表現を模索中', 'groping for expression', 1),
  P('A', 'なんていうんだろう', ['なんて', 'いう', 'ん', 'だろう'], 'utterance-initial', 'casual', 'filler', 'フィラー', '適切な言い方を探す', 'searching for right words', 2),
  P('A', 'どう言えばいいかな', ['どう', '言え', 'ば', 'いい', 'かな'], 'utterance-initial', 'casual', 'filler', 'フィラー', '表現方法を考える', 'considering how to say it', 2),

  // ── A.4 注意喚起 (Attention-Getting) ─────────────────────
  P('A', 'あのね', ['あの', 'ね'], 'utterance-initial', 'casual', 'attention', '注意喚起', '相手の注意を引く', 'draws listener attention', 1),
  P('A', 'でね', ['で', 'ね'], 'utterance-initial', 'casual', 'attention', '注意喚起', '話を展開しつつ注意を引く', 'develops story + draws attention', 1),
  P('A', 'ねえ', ['ねえ'], 'utterance-initial', 'casual', 'attention', '注意喚起', '呼びかけ', 'calling out', 1),
  P('A', 'ほら', ['ほら'], 'utterance-initial', 'casual', 'attention', '注意喚起', '共有知識に言及する', 'references shared knowledge', 1),
  P('A', 'ねえねえ', ['ねえ', 'ねえ'], 'utterance-initial', 'casual', 'attention', '注意喚起', '強い呼びかけ', 'insistent calling', 1),
  P('A', 'ちょっと聞いて', ['ちょっと', '聞い', 'て'], 'utterance-initial', 'casual', 'attention', '注意喚起', '聞いてほしいことがある', 'has something to share', 2),

  // ── A.5 譲歩開始 (Concession Starters) ──────────────────
  P('A', '確かに', ['確か', 'に'], 'utterance-initial', 'neutral', 'concession', '譲歩開始', '相手の意見を認める', 'concedes opponent point', 1, ['C010', 'C011']),
  P('A', 'もちろん', ['もちろん'], 'utterance-initial', 'neutral', 'concession', '譲歩開始', '当然のことを認める', 'acknowledges the obvious', 2),
  P('A', 'そりゃ', ['そりゃ'], 'utterance-initial', 'casual', 'concession', '譲歩開始', 'くだけた譲歩', 'casual concession', 1),
  P('A', 'そりゃそうだけど', ['そりゃ', 'そう', 'だ', 'けど'], 'utterance-initial', 'casual', 'concession', '譲歩開始', '認めつつ反論準備', 'concedes but prepares counter', 1),
  P('A', '言いたいことはわかるけど', ['言い', 'たい', 'こと', 'は', 'わかる', 'けど'], 'utterance-initial', 'casual', 'concession', '譲歩開始', '理解を示して反論', 'shows understanding then counters', 2),

  // ── A.6 対比・転換 (Contrast/Transition) ─────────────────
  P('A', 'でも', ['でも'], 'utterance-initial', 'casual', 'contrast', '対比・転換', '逆接', 'adversative connector', 1),
  P('A', 'ただ', ['ただ'], 'utterance-initial', 'neutral', 'contrast', '対比・転換', '部分的な反論', 'partial counterpoint', 1),
  P('A', 'ところが', ['ところが'], 'utterance-initial', 'neutral', 'contrast', '対比・転換', '予想外の結果', 'unexpected result', 2),
  P('A', '逆に', ['逆', 'に'], 'utterance-initial', 'neutral', 'contrast', '対比・転換', '反対の立場を示す', 'shows opposite stance', 1),
  P('A', 'むしろ', ['むしろ'], 'utterance-initial', 'neutral', 'contrast', '対比・転換', 'より適切な見方を提示', 'presents more apt view', 2),
  P('A', '一方で', ['一方', 'で'], 'utterance-initial', 'neutral', 'contrast', '対比・転換', '別の側面を示す', 'shows another aspect', 2),
  P('A', '反対に', ['反対', 'に'], 'utterance-initial', 'neutral', 'contrast', '対比・転換', '正反対を提示', 'presents the opposite', 3),
  P('A', 'それに対して', ['それ', 'に対して'], 'utterance-initial', 'neutral', 'contrast', '対比・転換', '前件と対比する', 'contrasts with preceding', 3),
  P('A', 'ていうか', ['ていうか'], 'utterance-initial', 'casual', 'self-repair', '対比・転換', '前言を修正する', 'corrects previous statement', 1),
  P('A', 'っていうか', ['っていうか'], 'utterance-initial', 'casual', 'self-repair', '対比・転換', '前言修正（強め）', 'corrects more emphatically', 1),
  P('A', 'いやいや', ['いや', 'いや'], 'utterance-initial', 'casual', 'disagreement', '対比・転換', '強い否定', 'strong disagreement', 1),
  P('A', 'いや', ['いや'], 'utterance-initial', 'casual', 'disagreement', '対比・転換', '否定・修正', 'denial/correction', 1),

  // ── A.7 情報源表示 (Information Source) ──────────────────
  P('A', '実は', ['実', 'は'], 'utterance-initial', 'neutral', 'information-source', '情報源表示', '意外な事実を導入', 'introduces unexpected fact', 1),
  P('A', '正直', ['正直'], 'utterance-initial', 'neutral', 'information-source', '情報源表示', '率直な意見を述べる', 'states frank opinion', 1),
  P('A', '正直言うと', ['正直', '言う', 'と'], 'utterance-initial', 'neutral', 'information-source', '情報源表示', '率直に言えば', 'to be honest', 2),
  P('A', 'ぶっちゃけ', ['ぶっちゃけ'], 'utterance-initial', 'slang', 'information-source', '情報源表示', '率直に言えば（俗）', 'frankly (slang)', 1),
  P('A', '本音を言うと', ['本音', 'を', '言う', 'と'], 'utterance-initial', 'neutral', 'information-source', '情報源表示', '本心を伝える', 'reveals true feelings', 3),
  P('A', '個人的には', ['個人的', 'に', 'は'], 'utterance-initial', 'neutral', 'hedge', '情報源表示', '個人的見解を示す', 'marks personal opinion', 2),

  // ── A.8 前提提示 (Premise) ──────────────────────────────
  P('A', 'そもそも', ['そもそも'], 'utterance-initial', 'neutral', 'topic-initiation', '前提提示', '根本的な前提に戻る', 'returns to fundamental premise', 1),
  P('A', '基本的に', ['基本的', 'に'], 'utterance-initial', 'neutral', 'topic-initiation', '前提提示', '基本原則を提示', 'presents basic principle', 2),
  P('A', '一応', ['一応'], 'utterance-initial', 'casual', 'hedge', '前提提示', '暫定的・条件付き', 'tentative/conditional', 1),
  P('A', 'ちなみに', ['ちなみに'], 'utterance-initial', 'neutral', 'addition', '前提提示', '補足情報を追加', 'adds supplementary info', 1),
  P('A', '前提として', ['前提', 'として'], 'utterance-initial', 'neutral', 'topic-initiation', '前提提示', '前提条件を明示', 'states prerequisite', 3),
  P('A', 'やっぱり', ['やっぱり'], 'utterance-initial', 'neutral', 'confirmation-seeking', '前提提示', '予想通りだと確認', 'confirms as expected', 1),
  P('A', 'やっぱ', ['やっぱ'], 'utterance-initial', 'casual', 'confirmation-seeking', '前提提示', '「やっぱり」短縮', 'shortened やっぱり', 1),

  // ── A.9 だから系 (Causal starters) ──────────────────────
  P('A', 'だから', ['だから'], 'utterance-initial', 'casual', 'cause', '因果', '理由・結論を述べる', 'states reason/conclusion', 1),
  P('A', 'だからさ', ['だから', 'さ'], 'utterance-initial', 'casual', 'cause', '因果', '強調的因果', 'emphatic causal', 1),
  P('A', 'だからこそ', ['だから', 'こそ'], 'utterance-initial', 'neutral', 'emphasis', '因果', 'まさにその理由で', 'for that very reason', 2),
  P('A', 'なので', ['なので'], 'utterance-initial', 'neutral', 'cause', '因果', 'より丁寧な因果', 'politer causal', 1),
  P('A', 'ですので', ['です', 'ので'], 'utterance-initial', 'polite', 'cause', '因果', '丁寧な因果', 'polite causal', 2),
  P('A', 'というのは', ['という', 'の', 'は'], 'utterance-initial', 'neutral', 'cause', '理由・説明', '理由を説明する', 'explains the reason', 1),
  P('A', 'なぜなら', ['なぜ', 'なら'], 'utterance-initial', 'formal', 'cause', '理由・説明', '論理的な理由提示', 'logical reason presentation', 3),
  P('A', 'なぜかというと', ['なぜ', 'か', 'という', 'と'], 'utterance-initial', 'neutral', 'cause', '理由・説明', '理由を述べるマーカー', 'reason-stating marker', 2),

  // ── A.10 結論提示 (Conclusion starters from PR8 YT patterns)
  P('A', '結論から言うと', ['結論', 'から', '言う', 'と'], 'utterance-initial', 'neutral', 'summary', '結論提示', '先に結論を述べる', 'states conclusion first', 2),
  P('A', '結論から言うとそんなことなくて', ['結論', 'から', '言う', 'と', 'そんな', 'こと', 'なく', 'て'], 'utterance-initial', 'casual', 'disagreement', '結論提示', '予想を否定する結論', 'conclusion that negates expectation', 2),
];

// ══════════════════════════════════════════════════════════════
// CATEGORY B: 発話末表現 (Utterance-Final Markers)
// ══════════════════════════════════════════════════════════════

const CAT_B: DiscoursePatternDef[] = [
  // ── B.1 のだ/んだ System (Explanatory) ──────────────────
  P('B', 'んですよ', ['ん', 'です', 'よ'], 'utterance-final', 'polite', 'assertion', 'のだ系', '説明的主張', 'explanatory assertion', 1),
  P('B', 'のですよ', ['の', 'です', 'よ'], 'utterance-final', 'polite', 'assertion', 'のだ系', '説明的主張（形式的）', 'formal explanatory assertion', 2),
  P('B', 'んですけど', ['ん', 'です', 'けど'], 'utterance-final', 'polite', 'hedge', 'のだ系', '説明＋ヘッジ', 'explanation + hedge', 1),
  P('B', 'んですけれども', ['ん', 'です', 'けれども'], 'utterance-final', 'formal', 'hedge', 'のだ系', '説明＋丁寧なヘッジ', 'explanation + formal hedge', 2),
  P('B', 'んだけど', ['ん', 'だ', 'けど'], 'utterance-final', 'casual', 'hedge', 'のだ系', '説明＋カジュアルなヘッジ', 'explanation + casual hedge', 1),
  P('B', 'んだよね', ['ん', 'だ', 'よ', 'ね'], 'utterance-final', 'casual', 'confirmation-seeking', 'のだ系', '同意を求める説明', 'explanation seeking agreement', 1),
  P('B', 'んですよね', ['ん', 'です', 'よ', 'ね'], 'utterance-final', 'polite', 'confirmation-seeking', 'のだ系', '丁寧に同意を求める', 'politely seeks agreement', 1),
  P('B', 'なんですよ', ['な', 'ん', 'です', 'よ'], 'utterance-final', 'polite', 'assertion', 'のだ系', '強い説明的主張', 'strong explanatory assertion', 1),
  P('B', 'なんだよね', ['な', 'ん', 'だ', 'よ', 'ね'], 'utterance-final', 'casual', 'confirmation-seeking', 'のだ系', '同意求め＋カジュアル', 'casual agreement-seeking', 1),
  P('B', 'んだよ', ['ん', 'だ', 'よ'], 'utterance-final', 'casual', 'assertion', 'のだ系', 'カジュアルな主張', 'casual assertion', 1),

  // ── B.2 わけ System (Reasoning) ─────────────────────────
  P('B', 'わけだから', ['わけ', 'だから'], 'utterance-final', 'neutral', 'cause', 'わけ系', '理由を示す', 'shows reason', 1),
  P('B', 'わけですよ', ['わけ', 'です', 'よ'], 'utterance-final', 'polite', 'assertion', 'わけ系', '理由を主張する', 'asserts reasoning', 1),
  P('B', 'わけなんですよ', ['わけ', 'な', 'ん', 'です', 'よ'], 'utterance-final', 'polite', 'emphasis', 'わけ系', '強調的な理由説明', 'emphatic reason explanation', 1),
  P('B', 'わけで', ['わけ', 'で'], 'utterance-final', 'neutral', 'result', 'わけ系', '帰結を導く', 'derives consequence', 1),
  P('B', 'わけですけど', ['わけ', 'です', 'けど'], 'utterance-final', 'polite', 'hedge', 'わけ系', '理由＋ヘッジ', 'reasoning + hedge', 2),
  P('B', 'わけじゃん', ['わけ', 'じゃん'], 'utterance-final', 'casual', 'confirmation-seeking', 'わけ系', '当然の理由を確認', 'confirms obvious reason', 1),
  P('B', 'わけなのよ', ['わけ', 'な', 'の', 'よ'], 'utterance-final', 'casual', 'assertion', 'わけ系', '理由の断定（女性的）', 'feminine reasoning assertion', 2),
  P('B', 'わけですけれども', ['わけ', 'です', 'けれども'], 'utterance-final', 'formal', 'hedge', 'わけ系', '形式的な理由＋ヘッジ', 'formal reasoning + hedge', 3),
  P('B', 'こういうこともあるわけです', ['こういう', 'こと', 'も', 'ある', 'わけ', 'です'], 'utterance-final', 'polite', 'assertion', 'わけ系', '例示的な理由づけ', 'exemplifying reasoning', 2),

  // ── B.3 はず System (Expectation) ───────────────────────
  P('B', 'はずなんですよね', ['はず', 'な', 'ん', 'です', 'よ', 'ね'], 'utterance-final', 'polite', 'confirmation-seeking', 'はず系', '期待の確認を求める', 'seeks confirmation of expectation', 1),
  P('B', 'はずなんですよ', ['はず', 'な', 'ん', 'です', 'よ'], 'utterance-final', 'polite', 'assertion', 'はず系', '期待を主張する', 'asserts expectation', 1),
  P('B', 'はずだから', ['はず', 'だから'], 'utterance-final', 'neutral', 'cause', 'はず系', '期待を根拠にする', 'uses expectation as basis', 2),
  P('B', 'はずですけど', ['はず', 'です', 'けど'], 'utterance-final', 'polite', 'hedge', 'はず系', '期待＋不確実性', 'expectation + uncertainty', 2),
  P('B', 'はずなのに', ['はず', 'な', 'の', 'に'], 'utterance-final', 'neutral', 'contrast', 'はず系', '期待と現実の乖離', 'gap between expectation and reality', 2),

  // ── B.4 もの System (Justification) ─────────────────────
  P('B', 'ものですから', ['もの', 'です', 'から'], 'utterance-final', 'polite', 'cause', 'もの系', '理由の弁明', 'justifying reason', 2),
  P('B', 'もんだから', ['もん', 'だから'], 'utterance-final', 'casual', 'cause', 'もの系', 'カジュアルな弁明', 'casual justification', 1),
  P('B', 'ものだ', ['もの', 'だ'], 'utterance-final', 'neutral', 'assertion', 'もの系', '一般的真理を述べる', 'states general truth', 2),
  P('B', 'もんね', ['もん', 'ね'], 'utterance-final', 'casual', 'agreement', 'もの系', '理由の共有確認', 'shared reason confirmation', 1),

  // ── B.5 伝聞・証拠性 (Hearsay/Evidentiality) ────────────
  P('B', 'そうです', ['そう', 'です'], 'utterance-final', 'polite', 'hearsay', '伝聞・証拠性', '伝聞情報を伝える', 'conveys hearsay', 2),
  P('B', 'ということです', ['という', 'こと', 'です'], 'utterance-final', 'polite', 'hearsay', '伝聞・証拠性', '情報の要約・伝達', 'summarizes/relays info', 2),
  P('B', 'らしいです', ['らしい', 'です'], 'utterance-final', 'polite', 'evidential', '伝聞・証拠性', '根拠のある推測', 'evidence-based conjecture', 1),
  P('B', 'みたいです', ['みたい', 'です'], 'utterance-final', 'polite', 'evidential', '伝聞・証拠性', '外観からの推測', 'appearance-based conjecture', 1),
  P('B', 'って言ってた', ['って', '言っ', 'て', 'た'], 'utterance-final', 'casual', 'quotation', '伝聞・証拠性', '他者の発言を伝える', 'reports someone else\'s words', 1),
  P('B', 'だそうです', ['だ', 'そう', 'です'], 'utterance-final', 'polite', 'hearsay', '伝聞・証拠性', '丁寧な伝聞', 'polite hearsay', 2),
  P('B', 'らしいんすよ', ['らしい', 'ん', 'す', 'よ'], 'utterance-final', 'casual', 'evidential', '伝聞・証拠性', 'カジュアルな推測報告', 'casual conjecture report', 1),
  P('B', 'みたいな感じで', ['みたい', 'な', '感じ', 'で'], 'utterance-final', 'casual', 'hedge', '伝聞・証拠性', '曖昧な例示', 'vague exemplification', 1),
  P('B', 'って聞いた', ['って', '聞い', 'た'], 'utterance-final', 'casual', 'hearsay', '伝聞・証拠性', '聞いた情報', 'heard information', 1),
  P('B', 'んだって', ['ん', 'だ', 'って'], 'utterance-final', 'casual', 'hearsay', '伝聞・証拠性', 'カジュアルな伝聞', 'casual hearsay', 1),

  // ── B.6 確認要求 (Confirmation-Seeking) ─────────────────
  P('B', 'じゃないですか', ['じゃないですか'], 'utterance-final', 'polite', 'confirmation-seeking', '確認要求', '共有知識の確認', 'confirms shared knowledge', 1),
  P('B', 'でしょう', ['でしょう'], 'utterance-final', 'polite', 'confirmation-seeking', '確認要求', '同意を求める', 'seeks agreement', 1),
  P('B', 'だろう', ['だろう'], 'utterance-final', 'neutral', 'confirmation-seeking', '確認要求', '推量・確認', 'conjecture/confirmation', 2),
  P('B', 'よね', ['よ', 'ね'], 'utterance-final', 'casual', 'confirmation-seeking', '確認要求', '同意確認', 'seeks confirmation', 1),
  P('B', 'ですよね', ['です', 'よ', 'ね'], 'utterance-final', 'polite', 'confirmation-seeking', '確認要求', '丁寧な同意確認', 'polite confirmation', 1),
  P('B', 'じゃん', ['じゃん'], 'utterance-final', 'casual', 'confirmation-seeking', '確認要求', '当然の確認', 'obvious confirmation', 1),
  P('B', 'でしょ', ['でしょ'], 'utterance-final', 'casual', 'confirmation-seeking', '確認要求', 'カジュアルな確認', 'casual confirmation', 1),
  P('B', 'じゃないの', ['じゃない', 'の'], 'utterance-final', 'casual', 'confirmation-seeking', '確認要求', '反語的確認', 'rhetorical confirmation', 2),
  P('B', 'んじゃない', ['ん', 'じゃない'], 'utterance-final', 'casual', 'confirmation-seeking', '確認要求', '推測的確認', 'speculative confirmation', 1),
  P('B', 'と思わない', ['と', '思わ', 'ない'], 'utterance-final', 'neutral', 'confirmation-seeking', '確認要求', '同意を強く求める', 'strongly seeks agreement', 2),

  // ── B.7 願望・義務 (Desire/Obligation) ──────────────────
  P('B', 'たいんですけど', ['たい', 'ん', 'です', 'けど'], 'utterance-final', 'polite', 'desire', '願望・義務', '願望＋ヘッジ', 'desire + hedge', 2),
  P('B', 'なきゃいけない', ['なきゃ', 'いけない'], 'utterance-final', 'casual', 'obligation', '願望・義務', '義務を述べる', 'states obligation', 1),
  P('B', 'なければならない', ['なければ', 'なら', 'ない'], 'utterance-final', 'formal', 'obligation', '願望・義務', '形式的な義務', 'formal obligation', 3),
  P('B', 'べきだ', ['べき', 'だ'], 'utterance-final', 'neutral', 'obligation', '願望・義務', '当為を述べる', 'states what ought to be', 2),
  P('B', 'ほうがいい', ['ほう', 'が', 'いい'], 'utterance-final', 'neutral', 'obligation', '願望・義務', '勧告・助言', 'recommendation/advice', 1),
  P('B', 'てほしい', ['て', 'ほしい'], 'utterance-final', 'neutral', 'desire', '願望・義務', '他者への要望', 'desire directed at others', 2),
  P('B', 'といいな', ['と', 'いい', 'な'], 'utterance-final', 'casual', 'desire', '願望・義務', '希望・願い', 'hope/wish', 2),

  // ── B.8 YT-specific endings (PR8) ──────────────────────
  P('B', 'て思ってました', ['て', '思っ', 'て', 'ました'], 'utterance-final', 'polite', 'information-source', 'YT話法', '感想を述べる', 'shares personal impression', 1),
  P('B', 'って感じですね', ['って', '感じ', 'です', 'ね'], 'utterance-final', 'polite', 'summary', 'YT話法', '印象でまとめる', 'wraps up with impression', 1),
  P('B', 'という感じですね', ['という', '感じ', 'です', 'ね'], 'utterance-final', 'polite', 'summary', 'YT話法', '内容をまとめる', 'summarizes content', 1),
  P('B', 'といった感じです', ['といった', '感じ', 'です'], 'utterance-final', 'polite', 'summary', 'YT話法', '列挙のまとめ', 'closes enumeration', 2),
  P('B', 'って話なんですけど', ['って', '話', 'な', 'ん', 'です', 'けど'], 'utterance-final', 'polite', 'topic-initiation', 'YT話法', '話題導入', 'introduces topic', 1),
  P('B', 'なんですけどね', ['な', 'ん', 'です', 'けど', 'ね'], 'utterance-final', 'polite', 'hedge', 'YT話法', '柔らかい断り・ヘッジ', 'soft hedge', 1),
];

// ══════════════════════════════════════════════════════════════
// CATEGORY C: 論理展開パターン (Logical Connectives)
// ══════════════════════════════════════════════════════════════

const CAT_C: DiscoursePatternDef[] = [
  // ── C.1 因果 (Cause-Effect) ─────────────────────────────
  P('C', 'から', ['から'], 'mid-utterance', 'neutral', 'cause', '因果', '原因を示す', 'indicates cause', 1),
  P('C', 'ので', ['ので'], 'mid-utterance', 'neutral', 'cause', '因果', '理由（やや客観的）', 'reason (somewhat objective)', 1),
  P('C', 'そのため', ['その', 'ため'], 'utterance-initial', 'formal', 'result', '因果', '結果を示す（形式的）', 'shows result (formal)', 3),
  P('C', 'その結果', ['その', '結果'], 'utterance-initial', 'formal', 'result', '因果', '結果を導入する', 'introduces result', 3),
  P('C', '従って', ['従って'], 'utterance-initial', 'formal', 'result', '因果', '論理的帰結', 'logical consequence', 4),
  P('C', 'おかげで', ['おかげ', 'で'], 'mid-utterance', 'neutral', 'cause', '因果', '恩恵的原因', 'beneficial cause', 2),
  P('C', 'せいで', ['せい', 'で'], 'mid-utterance', 'neutral', 'cause', '因果', '不利な原因', 'unfavorable cause', 2),
  P('C', 'だって', ['だって'], 'utterance-initial', 'casual', 'cause', '因果', '理由を述べる（弁明）', 'justifying reason', 1),

  // ── C.2 逆接 (Adversative) ──────────────────────────────
  P('C', 'けど', ['けど'], 'mid-utterance', 'casual', 'contrast', '逆接', '逆接・ヘッジ', 'adversative/hedge', 1),
  P('C', 'けれども', ['けれども'], 'mid-utterance', 'formal', 'contrast', '逆接', '形式的逆接', 'formal adversative', 2),
  P('C', 'しかし', ['しかし'], 'utterance-initial', 'formal', 'contrast', '逆接', '文語的逆接', 'literary adversative', 3),
  P('C', 'にもかかわらず', ['にもかかわらず'], 'mid-utterance', 'formal', 'contrast', '逆接', '強い逆接', 'strong adversative', 4),
  P('C', 'それなのに', ['それ', 'な', 'の', 'に'], 'utterance-initial', 'neutral', 'contrast', '逆接', '予想外の展開', 'unexpected development', 2),
  P('C', 'なのに', ['な', 'の', 'に'], 'mid-utterance', 'neutral', 'contrast', '逆接', '期待はずれ', 'contrary to expectation', 1),
  P('C', 'のに', ['の', 'に'], 'mid-utterance', 'neutral', 'contrast', '逆接', '逆接（残念）', 'adversative (regrettable)', 1),
  P('C', 'が', ['が'], 'mid-utterance', 'neutral', 'contrast', '逆接', '逆接・接続', 'adversative connector', 1),

  // ── C.3 添加 (Additive) ─────────────────────────────────
  P('C', 'しかも', ['しかも'], 'utterance-initial', 'neutral', 'addition', '添加', 'さらに加えて', 'furthermore', 1),
  P('C', 'さらに', ['さらに'], 'utterance-initial', 'neutral', 'addition', '添加', '追加する', 'adds more', 2),
  P('C', 'その上', ['その', '上'], 'utterance-initial', 'neutral', 'addition', '添加', '上乗せ', 'on top of that', 2),
  P('C', 'それに', ['それ', 'に'], 'utterance-initial', 'neutral', 'addition', '添加', '追加情報', 'additional info', 1),
  P('C', '加えて', ['加え', 'て'], 'utterance-initial', 'formal', 'addition', '添加', '形式的な追加', 'formal addition', 3),
  P('C', 'おまけに', ['おまけ', 'に'], 'utterance-initial', 'casual', 'addition', '添加', 'さらに悪いことに', 'to make matters worse', 2),
  P('C', 'それだけじゃなくて', ['それ', 'だけ', 'じゃなく', 'て'], 'utterance-initial', 'casual', 'addition', '添加', 'それだけでない', 'not just that', 1),

  // ── C.4 例示 (Exemplification) ──────────────────────────
  P('C', '例えば', ['例えば'], 'utterance-initial', 'neutral', 'elaboration', '例示', '具体例を示す', 'gives concrete example', 1),
  P('C', 'たとえばさ', ['たとえ', 'ば', 'さ'], 'utterance-initial', 'casual', 'elaboration', '例示', 'カジュアルな例示', 'casual exemplification', 1),
  P('C', 'いわば', ['いわば'], 'utterance-initial', 'neutral', 'elaboration', '例示', '比喩的に言えば', 'so to speak', 3),
  P('C', 'って言ったら', ['って', '言っ', 'たら'], 'mid-utterance', 'casual', 'elaboration', '例示・引用', '引用からオチへ', 'quote leading to punchline', 1),

  // ── C.5 言い換え (Rephrasing) ───────────────────────────
  P('C', '言い換えると', ['言い換える', 'と'], 'utterance-initial', 'neutral', 'rephrasing', '言い換え', '別の表現で述べる', 'restates differently', 3),
  P('C', 'というか', ['という', 'か'], 'mid-utterance', 'casual', 'rephrasing', '言い換え', '言い換え・修正', 'rephrase/correction', 1),
  P('C', 'もっと言うと', ['もっと', '言う', 'と'], 'utterance-initial', 'neutral', 'elaboration', '言い換え', 'さらに踏み込む', 'goes further', 2),
  P('C', 'の話必要ない', ['の', '話', '必要', 'ない'], 'mid-utterance', 'casual', 'self-repair', 'メタ発言', '自分の脱線を修正', 'self-corrects digression', 1),
  P('C', 'ややこしくなった', ['ややこしく', 'なっ', 'た'], 'mid-utterance', 'casual', 'self-repair', 'メタ発言', '複雑になったと認める', 'admits it got complicated', 1),
];

// ══════════════════════════════════════════════════════════════
// CATEGORY D: 談話境界標識 (Discourse Boundaries)
// ══════════════════════════════════════════════════════════════

const CAT_D: DiscoursePatternDef[] = [
  P('D', 'ところで', ['ところで'], 'utterance-initial', 'neutral', 'topic-shift', '話題転換', '話題を変える', 'changes topic', 1),
  P('D', '話変わるけど', ['話', '変わる', 'けど'], 'utterance-initial', 'casual', 'topic-shift', '話題転換', '明示的な話題転換', 'explicit topic change', 1),
  P('D', 'そういえば', ['そういえば'], 'utterance-initial', 'casual', 'topic-shift', '話題転換', '連想的話題転換', 'associative topic shift', 1),
  P('D', 'で、さっきの', ['で', 'さっき', 'の'], 'utterance-initial', 'casual', 'topic-return', '話題復帰', '前の話題に戻る', 'returns to earlier topic', 1),
  P('D', '話戻すと', ['話', '戻す', 'と'], 'utterance-initial', 'casual', 'topic-return', '話題復帰', '話を戻す', 'gets back on track', 1),
  P('D', '元に戻ると', ['元', 'に', '戻る', 'と'], 'utterance-initial', 'neutral', 'topic-return', '話題復帰', '元の話に戻る', 'returns to original topic', 2),
  P('D', 'ちょっと話戻しちゃいますけども', ['ちょっと', '話', '戻し', 'ちゃ', 'います', 'けども'], 'utterance-initial', 'polite', 'topic-return', '話題復帰', '丁寧な話題復帰（YT）', 'polite topic return (YT)', 1),
  P('D', '続いて', ['続い', 'て'], 'utterance-initial', 'neutral', 'sequence', '接続', '次のセクションへ', 'moves to next section', 2),
  P('D', 'はい', ['はい'], 'boundary', 'polite', 'turn-taking', '区切り', '区切り・承認', 'segment marker/acknowledgment', 1),
  P('D', 'さあ', ['さあ'], 'boundary', 'casual', 'attention', '区切り', '注意喚起・開始', 'attention/start marker', 1),
  P('D', 'こっからちょっと', ['こっから', 'ちょっと'], 'utterance-initial', 'casual', 'topic-initiation', '区切り', '新セクション開始', 'starts new section', 1),
  P('D', 'という感じですね', ['という', '感じ', 'です', 'ね'], 'utterance-final', 'polite', 'topic-close', '区切り', 'セクション終了', 'closes section', 1),
  P('D', 'それでは', ['それでは'], 'utterance-initial', 'polite', 'topic-shift', '区切り', '場面転換', 'scene change', 2),
  P('D', 'さて', ['さて'], 'utterance-initial', 'neutral', 'topic-shift', '区切り', '次の話題へ移る', 'moves to next topic', 2),
  P('D', 'というわけで', ['という', 'わけ', 'で'], 'utterance-initial', 'neutral', 'summary', '区切り', '前段のまとめ', 'summarizes preceding', 1),
  P('D', 'ということで', ['ということ', 'で'], 'utterance-initial', 'neutral', 'summary', '区切り', '結論的まとめ', 'conclusive summary', 1),
  P('D', 'じゃあ次', ['じゃあ', '次'], 'utterance-initial', 'casual', 'sequence', '区切り', '次の話題・項目へ', 'onto next topic/item', 1),
  P('D', 'それじゃあ', ['それじゃあ'], 'utterance-initial', 'casual', 'topic-shift', '区切り', '場面転換（カジュアル）', 'casual scene change', 1),

  // ── D.3 Section markers (expanded) ──────────────────────
  P('D', 'じゃあ早速', ['じゃあ', '早速'], 'utterance-initial', 'casual', 'topic-initiation', '区切り', '早速本題へ', 'gets right to it', 1),
  P('D', 'ここからが本題', ['ここ', 'から', 'が', '本題'], 'utterance-initial', 'neutral', 'topic-initiation', '話題転換', '本題を明示する', 'explicitly marks main topic', 2),
  P('D', '本題に入ると', ['本題', 'に', '入る', 'と'], 'utterance-initial', 'neutral', 'topic-initiation', '話題転換', '本題に移行', 'transitions to main topic', 2),
  P('D', 'ちなみに', ['ちなみ', 'に'], 'utterance-initial', 'neutral', 'topic-shift', '補足的転換', '補足情報を加える', 'adds supplementary info', 1),
  P('D', '余談ですが', ['余談', 'です', 'が'], 'utterance-initial', 'polite', 'topic-shift', '脱線', '脱線を明示する', 'explicitly marks digression', 2),
  P('D', '余談だけど', ['余談', 'だ', 'けど'], 'utterance-initial', 'casual', 'topic-shift', '脱線', '脱線を明示（口語）', 'marks digression (casual)', 1),
  P('D', '最後に', ['最後', 'に'], 'utterance-initial', 'neutral', 'sequence', '区切り', '最終項目を示す', 'marks final item', 2),
  P('D', 'それと', ['それ', 'と'], 'utterance-initial', 'casual', 'sequence', '接続', '追加項目', 'adds another item', 1),
  P('D', 'あとは', ['あと', 'は'], 'utterance-initial', 'casual', 'sequence', '接続', '残りの項目', 'remaining items', 1),
  P('D', 'ま、いいや', ['ま', 'いい', 'や'], 'utterance-initial', 'casual', 'topic-close', '区切り', '話題を切り上げる', 'drops the topic', 1),
  P('D', '以上です', ['以上', 'です'], 'utterance-final', 'polite', 'topic-close', '区切り', '終了宣言', 'declares end', 2),
  P('D', 'こんなところですかね', ['こんな', 'ところ', 'です', 'かね'], 'utterance-final', 'polite', 'topic-close', '区切り', '終了の確認', 'confirms ending', 1),
  P('D', 'ということでね', ['ということ', 'で', 'ね'], 'utterance-initial', 'casual', 'summary', '区切り', '結論的まとめ（語りかけ）', 'conclusive wrap-up (addressing)', 1),
  P('D', 'あと何だっけ', ['あと', '何', 'だっけ'], 'utterance-initial', 'casual', 'topic-shift', '区切り', '思い出そうとする', 'trying to recall', 1),
  P('D', 'そうだ', ['そう', 'だ'], 'utterance-initial', 'casual', 'topic-initiation', '区切り', '思い出し', 'sudden recall', 1),
  P('D', 'あ、そういえば', ['あ', 'そういえば'], 'utterance-initial', 'casual', 'topic-shift', '話題転換', '連想的想起', 'associative recall', 1),
];

// ══════════════════════════════════════════════════════════════
// CATEGORY E: 相互行為的表現 (Interactional Markers)
// ══════════════════════════════════════════════════════════════

const CAT_E: DiscoursePatternDef[] = [
  // ── Final particles ─────────────────────────────────────
  P('E', 'ね', ['ね'], 'utterance-final', 'any', 'agreement', '終助詞', '同意・確認', 'agreement/confirmation', 1),
  P('E', 'よ', ['よ'], 'utterance-final', 'any', 'assertion', '終助詞', '主張・伝達', 'assertion/informing', 1),
  P('E', 'さ', ['さ'], 'any', 'casual', 'filler', '終助詞', '会話潤滑', 'conversational lubricant', 1),
  P('E', 'な', ['な'], 'utterance-final', 'casual', 'emotional', '終助詞', '独り言・感嘆', 'self-directed/exclamation', 1),
  P('E', 'かな', ['かな'], 'utterance-final', 'casual', 'confirmation-seeking', '終助詞', '自問・疑問', 'self-questioning', 1),
  P('E', 'わ', ['わ'], 'utterance-final', 'casual', 'emotional', '終助詞', '感情表出', 'emotional expression', 2),
  P('E', 'ぞ', ['ぞ'], 'utterance-final', 'casual', 'emphasis', '終助詞', '強調・決意', 'emphasis/determination', 2),
  P('E', 'ぜ', ['ぜ'], 'utterance-final', 'casual', 'emphasis', '終助詞', '男性的強調', 'masculine emphasis', 3),

  // ── Backchannel/Agreement signals (YT-specific from PR8) ─
  P('E', 'そうそうそう', ['そう', 'そう', 'そう'], 'any', 'casual', 'backchannel', '相づち', '急速な同意', 'rapid agreement', 1),
  P('E', 'そうそうそうそう', ['そう', 'そう', 'そう', 'そう'], 'any', 'casual', 'backchannel', '相づち', '強い同意', 'emphatic rapid agreement', 1),
  P('E', 'はいはいはい', ['はい', 'はい', 'はい'], 'any', 'neutral', 'backchannel', '相づち', '素早い了承', 'quick acknowledgment', 1),
  P('E', 'うんうんうん', ['うん', 'うん', 'うん'], 'any', 'casual', 'backchannel', '相づち', 'カジュアルな了承', 'casual acknowledgment', 1),
  P('E', 'うん', ['うん'], 'any', 'casual', 'backchannel', '相づち', '同意・了承', 'agreement/acknowledgment', 1),
  P('E', 'ああ', ['ああ'], 'utterance-initial', 'casual', 'backchannel', '相づち', '理解・気づき', 'understanding/realization', 1),
  P('E', 'へえ', ['へえ'], 'utterance-initial', 'casual', 'surprise', '相づち', '驚き・関心', 'surprise/interest', 1),
  P('E', 'なるほど', ['なるほど'], 'utterance-initial', 'neutral', 'backchannel', '相づち', '理解・納得', 'understanding/acceptance', 1),
  P('E', 'なるほどね', ['なるほど', 'ね'], 'utterance-initial', 'casual', 'backchannel', '相づち', '理解＋共感', 'understanding + empathy', 1),
  P('E', 'たしかに', ['たしか', 'に'], 'utterance-initial', 'casual', 'agreement', '相づち', '同意を示す', 'shows agreement', 1),
  P('E', '分かる', ['分かる'], 'utterance-initial', 'casual', 'agreement', '相づち', '共感・理解', 'empathy/understanding', 1),
  P('E', 'わかるわかる', ['わかる', 'わかる'], 'utterance-initial', 'casual', 'agreement', '相づち', '強い共感', 'strong empathy', 1),
  P('E', 'まじで', ['まじ', 'で'], 'any', 'slang', 'surprise', '相づち', '驚き（俗語）', 'surprise (slang)', 1),
  P('E', 'マジ', ['マジ'], 'any', 'slang', 'surprise', '相づち', '驚き（カタカナ）', 'surprise (katakana)', 1),
  P('E', 'えー', ['えー'], 'utterance-initial', 'casual', 'surprise', '相づち', '驚き・困惑', 'surprise/bewilderment', 1),
  P('E', 'うそ', ['うそ'], 'utterance-initial', 'casual', 'surprise', '相づち', '信じられない', 'disbelief', 1),
  P('E', 'やば', ['やば'], 'any', 'slang', 'surprise', '相づち', '驚き（スラング）', 'amazement (slang)', 1),
  P('E', 'やばい', ['やばい'], 'any', 'slang', 'emotional', '相づち', '感情的反応', 'emotional reaction', 1),
  P('E', 'すごい', ['すごい'], 'any', 'casual', 'emotional', '相づち', '強い反応', 'strong reaction', 1),
  P('E', 'すごいね', ['すごい', 'ね'], 'any', 'casual', 'emotional', '相づち', '共感的称賛', 'empathetic praise', 1),

  // ── Turn management ─────────────────────────────────────
  P('E', 'ちょっと待って', ['ちょっと', '待っ', 'て'], 'utterance-initial', 'casual', 'turn-taking', 'ターン管理', '割り込み', 'interruption', 1),
  P('E', '言いたいんだけど', ['言い', 'たい', 'ん', 'だ', 'けど'], 'utterance-initial', 'casual', 'turn-taking', 'ターン管理', '発言権を求める', 'requests the floor', 2),
  P('E', 'あ、そうだ', ['あ', 'そう', 'だ'], 'utterance-initial', 'casual', 'topic-initiation', 'ターン管理', '思い出し', 'sudden recall', 1),
];

// ══════════════════════════════════════════════════════════════
// CATEGORY F: モダリティ (Modality)
// ══════════════════════════════════════════════════════════════

const CAT_F: DiscoursePatternDef[] = [
  // ── Epistemic (知識・確信度) ─────────────────────────────
  P('F', 'だろう', ['だろう'], 'utterance-final', 'neutral', 'epistemic', '認識的', '推量', 'conjecture', 1),
  P('F', 'かもしれない', ['かもしれない'], 'utterance-final', 'neutral', 'epistemic', '認識的', '可能性', 'possibility', 1),
  P('F', 'かもしれません', ['かもしれません'], 'utterance-final', 'polite', 'epistemic', '認識的', '可能性（丁寧）', 'possibility (polite)', 2),
  P('F', 'かも', ['かも'], 'utterance-final', 'casual', 'epistemic', '認識的', '可能性（略）', 'possibility (abbrev)', 1),
  P('F', 'はずだ', ['はず', 'だ'], 'utterance-final', 'neutral', 'epistemic', '認識的', '確信', 'conviction', 1),
  P('F', 'に違いない', ['に', '違い', 'ない'], 'utterance-final', 'neutral', 'epistemic', '認識的', '確信（強い）', 'strong conviction', 2),
  P('F', 'ようだ', ['よう', 'だ'], 'utterance-final', 'neutral', 'evidential', '認識的', '様態推測', 'manner-based conjecture', 2),
  P('F', 'みたいだ', ['みたい', 'だ'], 'utterance-final', 'casual', 'evidential', '認識的', '外観推測', 'appearance-based conjecture', 1),
  P('F', 'らしい', ['らしい'], 'utterance-final', 'neutral', 'evidential', '認識的', '伝聞推測', 'hearsay conjecture', 1),
  P('F', '気がする', ['気', 'が', 'する'], 'utterance-final', 'casual', 'epistemic', '認識的', '直感的推測', 'intuitive feeling', 1),
  P('F', 'っぽい', ['っぽい'], 'utterance-final', 'casual', 'epistemic', '認識的', '〜らしい（くだけた）', 'seems like (casual)', 1),
  P('F', '多分', ['多分'], 'any', 'neutral', 'epistemic', '認識的', 'おそらく', 'probably', 1),
  P('F', '絶対', ['絶対'], 'any', 'neutral', 'emphasis', '認識的', '確実に', 'absolutely', 1),
  P('F', '間違いなく', ['間違い', 'なく'], 'any', 'neutral', 'emphasis', '認識的', '疑いなく', 'without a doubt', 2),

  // ── Deontic (義務・許可) ─────────────────────────────────
  P('F', 'べきだ', ['べき', 'だ'], 'utterance-final', 'neutral', 'deontic', '義務的', '義務・当為', 'obligation/ought', 2),
  P('F', 'てもいい', ['て', 'も', 'いい'], 'utterance-final', 'neutral', 'deontic', '義務的', '許可', 'permission', 1),
  P('F', 'てはいけない', ['て', 'は', 'いけない'], 'utterance-final', 'neutral', 'deontic', '義務的', '禁止', 'prohibition', 2),
  P('F', 'ことだ', ['こと', 'だ'], 'utterance-final', 'neutral', 'deontic', '義務的', '一般的助言', 'general advice', 3),
  P('F', 'ないといけない', ['ない', 'と', 'いけない'], 'utterance-final', 'neutral', 'obligation', '義務的', '必要性', 'necessity', 1),
  P('F', 'なくちゃ', ['なく', 'ちゃ'], 'utterance-final', 'casual', 'obligation', '義務的', '口語的義務', 'colloquial obligation', 1),

  // ── Dynamic (能力・意志) ─────────────────────────────────
  P('F', 'できる', ['できる'], 'utterance-final', 'neutral', 'dynamic', '動態的', '能力・可能', 'ability/possibility', 1),
  P('F', 'られる', ['られる'], 'utterance-final', 'neutral', 'dynamic', '動態的', '可能態', 'potential form', 1),
  P('F', 'ようとする', ['よう', 'と', 'する'], 'utterance-final', 'neutral', 'dynamic', '動態的', '試み', 'attempt', 2),
  P('F', 'つもりだ', ['つもり', 'だ'], 'utterance-final', 'neutral', 'dynamic', '動態的', '意図', 'intention', 1),
  P('F', 'ことにする', ['こと', 'に', 'する'], 'utterance-final', 'neutral', 'dynamic', '動態的', '決定', 'decision', 2),
];

// ══════════════════════════════════════════════════════════════
// CATEGORY G: 引用・伝聞 (Quotation/Hearsay)
// ══════════════════════════════════════════════════════════════

const CAT_G: DiscoursePatternDef[] = [
  P('G', 'って', ['って'], 'mid-utterance', 'casual', 'quotation', '引用', 'カジュアル引用', 'casual quotation', 1),
  P('G', 'と', ['と'], 'mid-utterance', 'neutral', 'quotation', '引用', '引用助詞', 'quotation particle', 1),
  P('G', 'っていう', ['って', 'いう'], 'mid-utterance', 'casual', 'quotation', '引用', '〜と呼ばれる', 'called/referred as', 1),
  P('G', 'という', ['という'], 'mid-utterance', 'neutral', 'quotation', '引用', '〜と言われる', 'called (neutral)', 1),
  P('G', 'って言う', ['って', '言う'], 'mid-utterance', 'casual', 'quotation', '引用', '明示的引用', 'explicit quotation', 1),
  P('G', 'と言う', ['と', '言う'], 'mid-utterance', 'neutral', 'quotation', '引用', '明示的引用（中立）', 'explicit quotation (neutral)', 2),
  P('G', 'と思う', ['と', '思う'], 'utterance-final', 'neutral', 'epistemic', '内的引用', '自分の考え', 'own thought', 1),
  P('G', 'と思って', ['と', '思っ', 'て'], 'mid-utterance', 'neutral', 'epistemic', '内的引用', '思考の連鎖', 'chain of thought', 1),
  P('G', 'と思うんですけど', ['と', '思う', 'ん', 'です', 'けど'], 'utterance-final', 'polite', 'hedge', '内的引用', '意見＋ヘッジ', 'opinion + hedge', 1),
  P('G', 'かなと思って', ['かな', 'と', '思っ', 'て'], 'utterance-final', 'casual', 'hedge', '内的引用', '曖昧な意見', 'vague opinion', 1),
  P('G', 'って話', ['って', '話'], 'mid-utterance', 'casual', 'quotation', '引用', 'その話', 'that story/topic', 1),
  P('G', 'みたいなことを言ってて', ['みたい', 'な', 'こと', 'を', '言っ', 'て', 'て'], 'mid-utterance', 'casual', 'quotation', '引用', '不正確な引用', 'approximate quotation', 1),
  P('G', 'みたいな', ['みたい', 'な'], 'utterance-final', 'casual', 'quotation', '引用', '〜的な（引用的）', 'like/sort of (quotative)', 1),
  P('G', 'とか言って', ['とか', '言っ', 'て'], 'mid-utterance', 'casual', 'quotation', '引用', '軽い引用', 'light quotation', 1),

  // ── G.2 Expanded quotation & hearsay ────────────────────
  P('G', 'だって', ['だって'], 'utterance-initial', 'casual', 'quotation', '伝聞', '理由引用（だって〜だもん）', 'reason quotation', 1),
  P('G', 'らしいよ', ['らしい', 'よ'], 'utterance-final', 'casual', 'evidential', '伝聞', '伝聞＋伝達', 'hearsay + informing', 1),
  P('G', 'って聞いた', ['って', '聞い', 'た'], 'utterance-final', 'casual', 'quotation', '伝聞', '聞いた情報', 'heard information', 1),
  P('G', 'って聞いたんだけど', ['って', '聞い', 'た', 'ん', 'だ', 'けど'], 'utterance-final', 'casual', 'hedge', '伝聞', '聞いた＋ヘッジ', 'heard + hedge', 1),
  P('G', 'だそうです', ['だ', 'そう', 'です'], 'utterance-final', 'polite', 'evidential', '伝聞', '伝聞（丁寧）', 'hearsay (polite)', 2),
  P('G', 'とのことです', ['との', 'こと', 'です'], 'utterance-final', 'formal', 'evidential', '伝聞', '伝聞（フォーマル）', 'hearsay (formal)', 3),
  P('G', 'って言われて', ['って', '言わ', 'れて'], 'mid-utterance', 'casual', 'quotation', '受身引用', '言われた引用', 'was told quotation', 1),
  P('G', 'と言われている', ['と', '言わ', 'れ', 'て', 'いる'], 'mid-utterance', 'neutral', 'evidential', '定説', '定説・一般論', 'established opinion', 2),
  P('G', 'っていうか', ['って', 'いう', 'か'], 'utterance-initial', 'casual', 'rephrasing', '引用的修正', '言い直し', 'self-correction via quotation', 1),
  P('G', 'じゃないけど', ['じゃ', 'ない', 'けど'], 'mid-utterance', 'casual', 'quotation', '引用的修正', '否定的引用', 'negative citation (not exactly but)', 1),
  P('G', 'なんていうの', ['なんて', 'いう', 'の'], 'mid-utterance', 'casual', 'hedge', '引用', '言い方を探す', 'searching for expression', 1),
  P('G', 'いわゆる', ['いわゆる'], 'mid-utterance', 'neutral', 'quotation', '引用', 'いわゆる〜', 'so-called', 2),
  P('G', 'ってやつ', ['って', 'やつ'], 'utterance-final', 'casual', 'quotation', '引用', '〜というもの', 'the thing called', 1),
  P('G', 'って感じ', ['って', '感じ'], 'utterance-final', 'casual', 'quotation', '引用', '〜という印象', 'the feeling of', 1),
  P('G', 'みたいなこと', ['みたい', 'な', 'こと'], 'mid-utterance', 'casual', 'quotation', '引用', '不正確な引用', 'approximate quotation', 1),
  P('G', 'とか何とか', ['とか', '何', 'とか'], 'utterance-final', 'casual', 'quotation', '引用', '曖昧な引用', 'vague quotation', 1),
];

// ══════════════════════════════════════════════════════════════
// CATEGORY H: テンス・アスペクト (Tense/Aspect)
// ══════════════════════════════════════════════════════════════

const CAT_H: DiscoursePatternDef[] = [
  P('H', 'ている', ['ている'], 'mid-utterance', 'neutral', 'progressive', '進行・結果', '進行中・結果状態', 'progressive/resultative', 1),
  P('H', 'てる', ['てる'], 'mid-utterance', 'casual', 'progressive', '進行・結果', '進行中（口語）', 'progressive (colloquial)', 1),
  P('H', 'てある', ['て', 'ある'], 'mid-utterance', 'neutral', 'resultative', '結果', '結果状態（意図的）', 'resultative (intentional)', 2),
  P('H', 'てしまう', ['て', 'しまう'], 'mid-utterance', 'neutral', 'completion', '完了', '完了・残念', 'completion/regret', 1),
  P('H', 'ちゃう', ['ちゃう'], 'mid-utterance', 'casual', 'completion', '完了', '完了（口語）', 'completion (colloquial)', 1),
  P('H', 'ちゃった', ['ちゃった'], 'utterance-final', 'casual', 'regret', '完了', '不本意な完了', 'unintended completion', 1),
  P('H', 'ておく', ['て', 'おく'], 'mid-utterance', 'neutral', 'preparation', '準備', '事前準備', 'preparation in advance', 2),
  P('H', 'とく', ['とく'], 'mid-utterance', 'casual', 'preparation', '準備', '準備（口語）', 'preparation (colloquial)', 1),
  P('H', 'てくる', ['て', 'くる'], 'mid-utterance', 'neutral', 'progressive', '変化', '接近・変化の到来', 'approach/change arrival', 1),
  P('H', 'ていく', ['て', 'いく'], 'mid-utterance', 'neutral', 'progressive', '変化', '進行・離反', 'progression/departure', 1),
  P('H', 'たことがある', ['た', 'こと', 'が', 'ある'], 'utterance-final', 'neutral', 'experience', '経験', '経験を述べる', 'states experience', 1),
  P('H', 'ところだ', ['ところ', 'だ'], 'utterance-final', 'neutral', 'progressive', '局面', '動作の局面', 'phase of action', 2),
  P('H', 'ところだった', ['ところ', 'だっ', 'た'], 'utterance-final', 'neutral', 'experience', '局面', '危機一髪', 'close call', 2),
  P('H', 'ばかりだ', ['ばかり', 'だ'], 'utterance-final', 'neutral', 'progressive', '直後', '直後', 'just did', 2),
  P('H', 'たばかり', ['た', 'ばかり'], 'mid-utterance', 'neutral', 'progressive', '直後', 'したばかり', 'just completed', 1),
  P('H', 'ようとしている', ['よう', 'と', 'している'], 'mid-utterance', 'neutral', 'progressive', '局面', '始まりかけ', 'about to begin', 2),
  P('H', 'つつある', ['つつ', 'ある'], 'mid-utterance', 'formal', 'progressive', '進行', '漸進的変化', 'gradual change', 3),
  P('H', 'てみる', ['て', 'みる'], 'mid-utterance', 'neutral', 'dynamic', '試行', '試している', 'trying doing', 1),
  P('H', 'てみた', ['て', 'み', 'た'], 'utterance-final', 'neutral', 'experience', '試行', '試してみた結果', 'result of trying', 1),

  // ── H.2 Expanded aspect forms ───────────────────────────
  P('H', 'ようになる', ['よう', 'に', 'なる'], 'mid-utterance', 'neutral', 'progressive', '変化', '能力・習慣の変化', 'change in ability/habit', 1),
  P('H', 'ようになった', ['よう', 'に', 'なっ', 'た'], 'utterance-final', 'neutral', 'progressive', '変化', '変化の完了', 'completed change', 1),
  P('H', 'なくなる', ['なく', 'なる'], 'mid-utterance', 'neutral', 'progressive', '変化', '消失の変化', 'change to non-existence', 1),
  P('H', 'なくなった', ['なく', 'なっ', 'た'], 'utterance-final', 'neutral', 'completion', '変化', '消失の完了', 'completed disappearance', 1),
  P('H', 'ことになる', ['こと', 'に', 'なる'], 'mid-utterance', 'neutral', 'resultative', '結果', '状況的帰結', 'situational consequence', 2),
  P('H', 'ことになった', ['こと', 'に', 'なっ', 'た'], 'utterance-final', 'neutral', 'resultative', '結果', '決定された結果', 'decided outcome', 1),
  P('H', 'てからは', ['て', 'から', 'は'], 'mid-utterance', 'neutral', 'progressive', '時間', '以降の状態', 'state since then', 1),
  P('H', 'て以来', ['て', '以来'], 'mid-utterance', 'neutral', 'progressive', '時間', '以来ずっと', 'ever since', 2),
  P('H', 'たまま', ['た', 'まま'], 'mid-utterance', 'neutral', 'resultative', '結果', '状態の維持', 'maintained state', 1),
  P('H', 'っぱなし', ['っぱなし'], 'utterance-final', 'casual', 'resultative', '放置', '放置状態', 'left as-is', 1),
  P('H', 'かけ', ['かけ'], 'mid-utterance', 'neutral', 'progressive', '局面', '途中・未完了', 'midway/incomplete', 2),
  P('H', 'だした', ['だし', 'た'], 'utterance-final', 'neutral', 'progressive', '開始', '動作の開始', 'started doing', 1),
  P('H', 'はじめる', ['はじめる'], 'mid-utterance', 'neutral', 'progressive', '開始', '開始する', 'begins doing', 2),
  P('H', 'おわる', ['おわる'], 'mid-utterance', 'neutral', 'completion', '完了', '完了する', 'finishes doing', 2),
  P('H', '続ける', ['続ける'], 'mid-utterance', 'neutral', 'progressive', '継続', '継続する', 'continues doing', 2),
];

// ══════════════════════════════════════════════════════════════
// CATEGORY I: 待遇・レジスター (Politeness/Register)
// ══════════════════════════════════════════════════════════════

const CAT_I: DiscoursePatternDef[] = [
  // ── Polite forms ────────────────────────────────────────
  P('I', 'です', ['です'], 'utterance-final', 'polite', 'politeness', '丁寧語', '丁寧な断定', 'polite assertion', 1),
  P('I', 'ます', ['ます'], 'utterance-final', 'polite', 'politeness', '丁寧語', '丁寧な動詞形', 'polite verb form', 1),
  P('I', 'でございます', ['で', 'ございます'], 'utterance-final', 'honorific', 'politeness', '丁重語', '非常に丁寧な断定', 'very polite assertion', 4),
  P('I', 'ございます', ['ございます'], 'utterance-final', 'honorific', 'respect', '丁重語', '丁重語動詞', 'ultra-polite verb', 3),

  // ── Honorific (尊敬語) ──────────────────────────────────
  P('I', 'おっしゃる', ['おっしゃる'], 'mid-utterance', 'honorific', 'respect', '尊敬語', '「言う」の尊敬語', 'respectful "say"', 3),
  P('I', 'いらっしゃる', ['いらっしゃる'], 'mid-utterance', 'honorific', 'respect', '尊敬語', '「いる/行く/来る」の尊敬語', 'respectful "be/go/come"', 3),
  P('I', 'なさる', ['なさる'], 'mid-utterance', 'honorific', 'respect', '尊敬語', '「する」の尊敬語', 'respectful "do"', 3),
  P('I', 'ご覧になる', ['ご覧', 'に', 'なる'], 'mid-utterance', 'honorific', 'respect', '尊敬語', '「見る」の尊敬語', 'respectful "see"', 3),
  P('I', 'お〜になる', ['お', 'に', 'なる'], 'mid-utterance', 'honorific', 'respect', '尊敬語', '尊敬語パターン', 'respectful pattern', 3),
  P('I', '〜れる', ['れる'], 'mid-utterance', 'polite', 'respect', '尊敬語', '受身的尊敬', 'passive-form respect', 2),
  P('I', '〜られる', ['られる'], 'mid-utterance', 'polite', 'respect', '尊敬語', '可能・尊敬', 'potential/respect', 2),

  // ── Humble (謙譲語) ─────────────────────────────────────
  P('I', 'いたす', ['いたす'], 'mid-utterance', 'humble', 'humility', '謙譲語', '「する」の謙譲語', 'humble "do"', 3),
  P('I', '申す', ['申す'], 'mid-utterance', 'humble', 'humility', '謙譲語', '「言う」の謙譲語', 'humble "say"', 3),
  P('I', '参る', ['参る'], 'mid-utterance', 'humble', 'humility', '謙譲語', '「行く/来る」の謙譲語', 'humble "go/come"', 3),
  P('I', 'いただく', ['いただく'], 'mid-utterance', 'humble', 'humility', '謙譲語', '「もらう」の謙譲語', 'humble "receive"', 2),
  P('I', 'くださる', ['くださる'], 'mid-utterance', 'honorific', 'respect', '尊敬語', '「くれる」の尊敬語', 'respectful "give"', 2),
  P('I', '拝見する', ['拝見', 'する'], 'mid-utterance', 'humble', 'humility', '謙譲語', '「見る」の謙譲語', 'humble "see"', 3),

  // ── Casual/Slang register markers ──────────────────────
  P('I', 'めっちゃ', ['めっちゃ'], 'any', 'slang', 'emphasis', '俗語', '「とても」のスラング', '"very" slang', 1),
  P('I', '超', ['超'], 'any', 'slang', 'emphasis', '俗語', '「とても」のスラング', '"very" prefix slang', 1),
  P('I', 'マジで', ['マジ', 'で'], 'any', 'slang', 'emphasis', '俗語', '本気で・本当に', 'seriously/really', 1),
  P('I', 'ガチで', ['ガチ', 'で'], 'any', 'slang', 'emphasis', '俗語', '本気で（新しい）', 'seriously (newer slang)', 1),
  P('I', 'ぶっちゃけ', ['ぶっちゃけ'], 'utterance-initial', 'slang', 'information-source', '俗語', 'ぶっちゃけて言えば', 'frankly speaking', 1),
];

// ══════════════════════════════════════════════════════════════
// LOGICAL FLOW SEQUENCES (Multi-marker co-occurrence from PR9)
// ══════════════════════════════════════════════════════════════

export interface LogicalFlowDef {
  id: string;
  name: string;
  nameEn: string;
  /** Ordered sequence of pattern IDs that form this flow */
  sequence: string[];
  description: string;
  descriptionEn: string;
  /** Example from YT transcript */
  example: string;
}

export const LOGICAL_FLOWS: LogicalFlowDef[] = [
  {
    id: 'LF001', name: '因果連鎖', nameEn: 'Cause → Result',
    sequence: ['C001', 'B011'], // から → わけで
    description: '原因を述べてから結果・帰結を導く',
    descriptionEn: 'States cause then derives consequence',
    example: '忙しいから、全然時間がないわけで',
  },
  {
    id: 'LF002', name: '逆接展開', nameEn: 'Contrast Development',
    sequence: ['C009', 'B001'], // けど → んですよ
    description: '逆接で留保しつつ主張を展開する',
    descriptionEn: 'Hedges with adversative then develops assertion',
    example: '難しいけど、やっぱり大事なんですよ',
  },
  {
    id: 'LF003', name: '段階的展開', nameEn: 'Stepwise Elaboration',
    sequence: ['A016', 'B003'], // で → んですけど
    description: '話を段階的に進めてヘッジで締める',
    descriptionEn: 'Advances story stepwise, closes with hedge',
    example: 'でなんか調べてたんですけど',
  },
  {
    id: 'LF004', name: '譲歩→反論', nameEn: 'Concession → Rebuttal',
    sequence: ['A050', 'A053', 'B001'], // 確かに → でも → んですよ
    description: '相手の意見を認めてから反論する',
    descriptionEn: 'Acknowledges opponent then rebuts',
    example: '確かにその通りなんだけど、でもやっぱり違うんですよ',
  },
  {
    id: 'LF005', name: '主張→挑戦→反論', nameEn: 'Thesis → Challenge → Refutation',
    sequence: ['B046', 'A078'], // じゃないですか → 結論から言うとそんなことなくて
    description: '通説を確認してから覆す',
    descriptionEn: 'Confirms common view then overturns it',
    example: 'みんなそう思うじゃないですか。結論から言うとそんなことなくて',
  },
  {
    id: 'LF006', name: '設定→オチ', nameEn: 'Setup → Punchline',
    sequence: ['C031', 'E009'], // って言ったら → そうそうそう
    description: '引用からオチへ展開する',
    descriptionEn: 'Develops from quote to punchline',
    example: '何の話って言ったらさ、そうそうそう',
  },
  {
    id: 'LF007', name: '証拠連鎖', nameEn: 'Evidence Chain',
    sequence: ['A027', 'A028'], // 1つはさ → あともう1個
    description: '複数の証拠を列挙する',
    descriptionEn: 'Enumerates multiple pieces of evidence',
    example: '1つはさ、値段の問題。あともう1個はクオリティ',
  },
  {
    id: 'LF008', name: '説明→まとめ', nameEn: 'Explanation → Summary',
    sequence: ['A071', 'D015'], // というのは → というわけで
    description: '理由を説明してからまとめる',
    descriptionEn: 'Explains reason then summarizes',
    example: 'というのは最近変わったらしくて、というわけで',
  },
  {
    id: 'LF009', name: '前提→帰結', nameEn: 'Premise → Consequence',
    sequence: ['A066', 'A073'], // そもそも → だから
    description: '根本的前提を示してから結論を導く',
    descriptionEn: 'Establishes fundamental premise then derives conclusion',
    example: 'そもそも日本語って難しいから、だからこそ面白い',
  },
  {
    id: 'LF010', name: '列挙→追加→まとめ', nameEn: 'Enumerate → Add → Summarize',
    sequence: ['A009', 'C018', 'A001'], // まず → しかも → 結局
    description: '項目を列挙し、追加して結論する',
    descriptionEn: 'Lists items, adds more, then concludes',
    example: 'まず値段が安い。しかも品質もいい。結局一番お得',
  },
  {
    id: 'LF011', name: '話題転換→新展開', nameEn: 'Topic Shift → New Development',
    sequence: ['D001', 'A009'], // ところで → まず
    description: '話題を変えて新しい展開を始める',
    descriptionEn: 'Changes topic and starts new development',
    example: 'ところで、まず最初に言いたいのは',
  },
  {
    id: 'LF012', name: '伝聞→評価', nameEn: 'Hearsay → Evaluation',
    sequence: ['B035', 'G007'], // って言ってた → と思う
    description: '他者の発言を引用してから自分の評価を述べる',
    descriptionEn: 'Quotes others then gives own evaluation',
    example: 'みんなそう言ってたけど、僕はそうは思わない',
  },
  {
    id: 'LF013', name: '修正→再提示', nameEn: 'Repair → Restatement',
    sequence: ['A060', 'A002'], // ていうか → 要するに
    description: '前言を修正して言い直す',
    descriptionEn: 'Corrects previous statement and restates',
    example: 'ていうか、要するにそういうことなんですよ',
  },
  {
    id: 'LF014', name: 'ヘッジ→主張', nameEn: 'Hedge → Assertion',
    sequence: ['A068', 'F012'], // 一応 → 絶対
    description: '控えめに始めて強い主張で締める',
    descriptionEn: 'Starts tentatively, closes with strong assertion',
    example: '一応確認したんですけど、これは絶対正しい',
  },
  {
    id: 'LF015', name: '驚き→共感', nameEn: 'Surprise → Empathy',
    sequence: ['E017', 'E021'], // へえ → なるほど
    description: '驚きから理解・共感に移行',
    descriptionEn: 'Transitions from surprise to understanding',
    example: 'へえ、なるほどね、そういうことか',
  },
  {
    id: 'LF016', name: '情報提示→反応要求', nameEn: 'Info → Response Request',
    sequence: ['A065', 'B046'], // 実は → じゃないですか
    description: '意外な情報を提示して反応を求める',
    descriptionEn: 'Presents surprising info and seeks response',
    example: '実はそうじゃないですか',
  },
  {
    id: 'LF017', name: '類推→メタコメント', nameEn: 'Analogy → Meta-comment',
    sequence: ['C028', 'C035'], // 例えば → の話必要ない
    description: '類推を展開してからメタ的に自己修正する',
    descriptionEn: 'Develops analogy then meta-corrects',
    example: '例えばさ、車で言うと... あ、その話必要ない',
  },
  // ── Expanded flows (LF018+) added by sentence-relations engine ──
  {
    id: 'LF018', name: 'ツッコミ連鎖', nameEn: 'Tsukkomi Chain',
    sequence: ['J004', 'J009'],
    description: '否定ツッコミから修正へ展開する',
    descriptionEn: 'Denial tsukkomi develops into correction',
    example: 'いやいや、そうじゃなくて、こういうことでしょ',
  },
  {
    id: 'LF019', name: '反応→深堀り', nameEn: 'Reaction → Dig Deeper',
    sequence: ['J032', 'K019'],
    description: '理解反応から理由の深堀りへ',
    descriptionEn: 'Understanding reaction leads to deeper inquiry',
    example: 'なるほどね。なぜかというとさ…',
  },
  {
    id: 'LF020', name: '共感→体験共有', nameEn: 'Empathy → Shared Experience',
    sequence: ['M015', 'M005'],
    description: '共感の表明から自分の体験の共有へ',
    descriptionEn: 'From empathy expression to sharing own experience',
    example: 'わかるわー。自分もそうだった',
  },
  {
    id: 'LF021', name: '定義→具体例→要約', nameEn: 'Define → Example → Summarize',
    sequence: ['L001', 'K024', 'A001'],
    description: '定義→例示→まとめの説明三段構成',
    descriptionEn: 'Three-part explanation: define, exemplify, summarize',
    example: 'というのは〇〇で、例えば△△。結局こういうこと',
  },
  {
    id: 'LF022', name: '物語→オチ→反応', nameEn: 'Story → Punchline → Reaction',
    sequence: ['M001', 'M002', 'J030'],
    description: '体験談→意外な展開→強い反応',
    descriptionEn: 'Personal story → unexpected turn → strong reaction',
    example: 'この前さ、カフェ行ったのよ。そしたらなんと…やばくない？',
  },
  {
    id: 'LF023', name: '主張→挑戦→反論→再主張', nameEn: 'Claim → Challenge → Rebuttal → Reassert',
    sequence: ['K006', 'K016', 'K010', 'K003'],
    description: '結論→疑問→反論→再主張の討論フレーム',
    descriptionEn: 'Conclusion → question → rebuttal → reassertion debate frame',
    example: '結論から言うと〇〇。でもそれって△△？それは違うと思う。はっきり言って□□',
  },
  {
    id: 'LF024', name: '解説段階展開', nameEn: 'Stepwise Explanation',
    sequence: ['L021', 'L022', 'L023', 'L024'],
    description: '段階的に解説して要約で締める',
    descriptionEn: 'Step-by-step explanation closing with summary',
    example: 'まず最初に〇〇。次のステップとして△△。最終的には□□。つまりどういうことか…',
  },
  {
    id: 'LF025', name: '脱線→復帰', nameEn: 'Digression → Return',
    sequence: ['L025', 'M025'],
    description: '補足的脱線からの復帰',
    descriptionEn: 'Return from supplementary digression',
    example: 'ちなみにこれは余談だけど…元の話に戻ると',
  },
  {
    id: 'LF026', name: '驚き→確認→共感', nameEn: 'Surprise → Confirm → Empathy',
    sequence: ['J024', 'J027', 'J034'],
    description: '驚き→確認→納得の反応連鎖',
    descriptionEn: 'Surprise → confirmation → convinced reaction chain',
    example: 'えー！まじか。たしかにそうだよね',
  },
  {
    id: 'LF027', name: '立場表明→根拠→譲歩', nameEn: 'Stance → Evidence → Concession',
    sequence: ['K031', 'K019', 'K014'],
    description: '意見→理由→ただし的留保',
    descriptionEn: 'Opinion → reason → reservation',
    example: '個人的には賛成。なぜかというと…まあそうとも限らないけど',
  },
];

// ══════════════════════════════════════════════════════════════
// CATEGORY J: ツッコミ・反応 (Tsukkomi / Reactions)
//   Comedy, banter, emotional reactions in conversation.
//   Critical for 討論, バラエティ, 雑談 genres.
// ══════════════════════════════════════════════════════════════

const CAT_J: DiscoursePatternDef[] = [
  // ── J.1 ツッコミ (Retorts/Corrections) ─────────────────
  P('J', 'なんでやねん', ['なんでやねん'], 'utterance-initial', 'slang', 'tsukkomi', 'ツッコミ', '関西風ツッコミの定番', 'classic Kansai tsukkomi', 1),
  P('J', 'ちゃうわ', ['ちゃう', 'わ'], 'utterance-initial', 'slang', 'tsukkomi', 'ツッコミ', '関西風否定ツッコミ', 'Kansai denial tsukkomi', 2),
  P('J', 'おいおい', ['おい', 'おい'], 'utterance-initial', 'casual', 'tsukkomi', 'ツッコミ', '呆れたツッコミ', 'exasperated retort', 1),
  P('J', 'いやいやいや', ['いや', 'いや', 'いや'], 'utterance-initial', 'casual', 'tsukkomi', 'ツッコミ', '強い否定ツッコミ', 'strong denial tsukkomi', 1),
  P('J', 'いやいや', ['いや', 'いや'], 'utterance-initial', 'casual', 'tsukkomi', 'ツッコミ', '否定ツッコミ', 'denial tsukkomi', 1),
  P('J', 'ちょっと待って', ['ちょっと', '待って'], 'utterance-initial', 'casual', 'tsukkomi', 'ツッコミ', '割り込みツッコミ', 'interruption tsukkomi', 1),
  P('J', '待って待って', ['待って', '待って'], 'utterance-initial', 'casual', 'tsukkomi', 'ツッコミ', '緊急割り込み', 'urgent interruption', 1),
  P('J', 'いや待て', ['いや', '待て'], 'utterance-initial', 'casual', 'tsukkomi', 'ツッコミ', '制止ツッコミ', 'stopping tsukkomi', 2),
  P('J', 'そうじゃなくて', ['そう', 'じゃ', 'なく', 'て'], 'utterance-initial', 'casual', 'tsukkomi', '修正ツッコミ', '方向修正', 'correction/redirecting', 1),
  P('J', '違う違う', ['違う', '違う'], 'utterance-initial', 'casual', 'tsukkomi', '修正ツッコミ', '強い否定・修正', 'strong denial/correction', 1),
  P('J', 'いや違うって', ['いや', '違う', 'って'], 'utterance-initial', 'casual', 'tsukkomi', '修正ツッコミ', '反復的否定', 'repeated denial', 1),
  P('J', 'なんだそれ', ['なんだ', 'それ'], 'utterance-initial', 'casual', 'tsukkomi', 'ツッコミ', '呆れた反応', 'baffled reaction', 1),
  P('J', '何言ってんの', ['何', '言って', 'ん', 'の'], 'utterance-initial', 'casual', 'tsukkomi', 'ツッコミ', '理解不能ツッコミ', 'incomprehension tsukkomi', 1),
  P('J', 'それはない', ['それ', 'は', 'ない'], 'utterance-initial', 'casual', 'tsukkomi', '否定ツッコミ', 'ありえない否定', 'outright denial', 1),
  P('J', 'ありえない', ['ありえない'], 'any', 'casual', 'tsukkomi', '否定ツッコミ', '強い否定反応', 'impossible/no way', 1),
  P('J', '嘘でしょ', ['嘘', 'でしょ'], 'utterance-initial', 'casual', 'surprise', 'ツッコミ', '信じられない反応', 'disbelief reaction', 1),
  P('J', 'うそやん', ['うそ', 'やん'], 'utterance-initial', 'slang', 'surprise', 'ツッコミ', '関西風信じられない', 'Kansai disbelief', 1),
  P('J', 'えぇー', ['えぇー'], 'utterance-initial', 'casual', 'surprise', 'ツッコミ', '驚き反応', 'surprise reaction', 1),
  P('J', '怒られるぞ', ['怒ら', 'れる', 'ぞ'], 'utterance-final', 'casual', 'tsukkomi', '警告ツッコミ', '冗談的警告', 'playful warning', 2),
  P('J', 'やばくない', ['やば', 'く', 'ない'], 'any', 'slang', 'tsukkomi', 'ツッコミ', '同意求めツッコミ', 'seeking agreement tsukkomi', 1),

  // ── J.2 反応 (Reactions/Backchannels) ──────────────────
  P('J', 'へー', ['へー'], 'utterance-initial', 'casual', 'reaction', '反応', '関心を示す', 'shows interest', 1),
  P('J', 'へぇー', ['へぇー'], 'utterance-initial', 'casual', 'reaction', '反応', '強い関心', 'strong interest', 1),
  P('J', 'ほー', ['ほー'], 'utterance-initial', 'casual', 'reaction', '反応', '感心反応', 'impressed reaction', 1),
  P('J', 'えー', ['えー'], 'utterance-initial', 'casual', 'surprise', '反応', '驚き反応', 'surprise reaction', 1),
  P('J', 'うそー', ['うそー'], 'utterance-initial', 'casual', 'surprise', '反応', '信じがたい反応', 'hard to believe', 1),
  P('J', 'まじで', ['まじ', 'で'], 'utterance-initial', 'slang', 'surprise', '反応', '驚き確認', 'seriously?', 1),
  P('J', 'まじか', ['まじ', 'か'], 'utterance-initial', 'slang', 'surprise', '反応', '信じられない', 'really?', 1),
  P('J', 'やば', ['やば'], 'utterance-initial', 'slang', 'reaction', '反応', '強い感情反応', 'intense emotional reaction', 1),
  P('J', 'やばい', ['やばい'], 'any', 'slang', 'reaction', '反応', '万能感嘆', 'universal exclamation', 1),
  P('J', 'すごい', ['すごい'], 'any', 'casual', 'reaction', '反応', '感嘆反応', 'amazement reaction', 1),
  P('J', 'すげー', ['すげー'], 'any', 'slang', 'reaction', '反応', '感嘆（粗い）', 'amazement (rough)', 1),
  P('J', 'なるほど', ['なるほど'], 'utterance-initial', 'neutral', 'reaction', '反応', '理解を示す', 'shows understanding', 1),
  P('J', 'なるほどね', ['なるほど', 'ね'], 'utterance-initial', 'casual', 'reaction', '反応', '理解＋共感', 'understanding + empathy', 1),
  P('J', 'たしかに', ['たしか', 'に'], 'utterance-initial', 'casual', 'agreement', '反応', '同意反応', 'agreement reaction', 1),
  P('J', 'わかる', ['わかる'], 'utterance-initial', 'casual', 'empathy', '反応', '共感反応', 'empathy reaction', 1),
  P('J', 'わかるー', ['わかるー'], 'utterance-initial', 'casual', 'empathy', '反応', '強い共感', 'strong empathy', 1),
  P('J', 'それな', ['それ', 'な'], 'utterance-initial', 'slang', 'agreement', '反応', '強い同意（若者語）', 'strong agreement (youth)', 1),
  P('J', 'ほんとそれ', ['ほんと', 'それ'], 'utterance-initial', 'casual', 'agreement', '反応', '完全同意', 'total agreement', 1),
  P('J', 'あーね', ['あー', 'ね'], 'utterance-initial', 'casual', 'reaction', '反応', '納得反応', 'convinced reaction', 1),
  P('J', 'はいはいはい', ['はい', 'はい', 'はい'], 'utterance-initial', 'casual', 'backchannel', '反応', '急ぎ了解', 'quick acknowledgement', 1),
  P('J', 'うんうん', ['うん', 'うん'], 'utterance-initial', 'casual', 'backchannel', '反応', '頷き', 'nodding along', 1),
  P('J', 'そうそうそう', ['そう', 'そう', 'そう'], 'utterance-initial', 'casual', 'agreement', '反応', '強い肯定', 'emphatic affirmation', 1),
  P('J', 'ウケる', ['ウケる'], 'any', 'slang', 'reaction', '反応', '面白い反応', 'funny reaction', 1),
  P('J', '草', ['草'], 'utterance-final', 'slang', 'reaction', '反応', '笑い（ネット語）', 'laughter (internet)', 1),
  P('J', 'www', ['www'], 'utterance-final', 'slang', 'reaction', '反応', '笑い（テキスト）', 'laughter (text)', 1),
];

// ══════════════════════════════════════════════════════════════
// CATEGORY K: 討論パターン (Debate/Discussion Patterns)
//   Argumentation, persuasion, challenge, rebuttal.
//   Critical for 討論 genre YouTube content.
// ══════════════════════════════════════════════════════════════

const CAT_K: DiscoursePatternDef[] = [
  // ── K.1 主張提示 (Presenting Claims) ───────────────────
  P('K', '私の意見としては', ['私', 'の', '意見', 'として', 'は'], 'utterance-initial', 'polite', 'stance-marking', '主張提示', '意見表明の前置き', 'opinion presentation prefix', 2),
  P('K', '僕が思うに', ['僕', 'が', '思う', 'に'], 'utterance-initial', 'casual', 'stance-marking', '主張提示', '個人的見解', 'personal view', 1),
  P('K', 'はっきり言って', ['はっきり', '言っ', 'て'], 'utterance-initial', 'neutral', 'assertion', '主張提示', '直接的主張', 'direct assertion', 1),
  P('K', '断言しますけど', ['断言', 'します', 'けど'], 'utterance-initial', 'polite', 'assertion', '主張提示', '強い主張＋ヘッジ', 'strong claim + hedge', 2),
  P('K', '間違いなく', ['間違い', 'なく'], 'utterance-initial', 'neutral', 'assertion', '主張提示', '確信的主張', 'certain assertion', 1),
  P('K', '結論から言うと', ['結論', 'から', '言う', 'と'], 'utterance-initial', 'neutral', 'assertion', '主張提示', '結論先行', 'conclusion-first', 1),
  P('K', 'ポイントは', ['ポイント', 'は'], 'utterance-initial', 'neutral', 'topic-initiation', '主張提示', '要点の提示', 'presenting the point', 1),
  P('K', '問題は', ['問題', 'は'], 'utterance-initial', 'neutral', 'topic-initiation', '主張提示', '問題提起', 'raising the issue', 1),
  P('K', '大事なのは', ['大事', 'な', 'の', 'は'], 'utterance-initial', 'neutral', 'emphasis', '主張提示', '重要点の強調', 'emphasizing key point', 1),

  // ── K.2 反論・異議 (Rebuttal/Objection) ────────────────
  P('K', 'それは違うと思う', ['それ', 'は', '違う', 'と', '思う'], 'utterance-initial', 'neutral', 'rebuttal', '反論', '丁寧な反論', 'polite rebuttal', 1),
  P('K', 'いやそれは', ['いや', 'それ', 'は'], 'utterance-initial', 'casual', 'rebuttal', '反論', 'カジュアル反論', 'casual rebuttal', 1),
  P('K', 'それは言い過ぎ', ['それ', 'は', '言い', '過ぎ'], 'utterance-initial', 'casual', 'rebuttal', '反論', '誇張の指摘', 'pointing out exaggeration', 1),
  P('K', 'そうとも限らない', ['そう', 'とも', '限ら', 'ない'], 'utterance-initial', 'neutral', 'rebuttal', '反論', '部分的否定', 'partial denial', 2),
  P('K', '必ずしもそうではない', ['必ずしも', 'そう', 'で', 'は', 'ない'], 'utterance-initial', 'formal', 'rebuttal', '反論', '慎重な反論', 'careful rebuttal', 2),
  P('K', 'でもそれって', ['でも', 'それ', 'って'], 'utterance-initial', 'casual', 'challenge', '反論', '疑問型反論', 'questioning rebuttal', 1),
  P('K', 'ちょっとそれは', ['ちょっと', 'それ', 'は'], 'utterance-initial', 'casual', 'rebuttal', '反論', '控えめ反論', 'mild rebuttal', 1),
  P('K', 'それってさ', ['それ', 'って', 'さ'], 'utterance-initial', 'casual', 'challenge', '反論', '挑戦的質問', 'challenging question', 1),

  // ── K.3 根拠提示 (Presenting Evidence) ─────────────────
  P('K', 'なぜかというと', ['なぜ', 'か', 'という', 'と'], 'utterance-initial', 'neutral', 'cause', '根拠提示', '理由説明の開始', 'reason explanation start', 1),
  P('K', 'なぜなら', ['なぜ', 'なら'], 'utterance-initial', 'formal', 'cause', '根拠提示', '理由提示（書き言葉的）', 'reason (literary)', 2),
  P('K', '実際に', ['実際', 'に'], 'utterance-initial', 'neutral', 'evidential', '根拠提示', '事実に基づく主張', 'fact-based claim', 1),
  P('K', 'データを見ると', ['データ', 'を', '見る', 'と'], 'utterance-initial', 'neutral', 'evidential', '根拠提示', 'データ参照', 'data reference', 2),
  P('K', '例えば', ['例えば'], 'utterance-initial', 'neutral', 'counter-example', '根拠提示', '具体例の提示', 'giving example', 1),
  P('K', '具体的に言うと', ['具体的', 'に', '言う', 'と'], 'utterance-initial', 'neutral', 'elaboration', '根拠提示', '具体化', 'being specific', 2),
  P('K', '事実として', ['事実', 'として'], 'utterance-initial', 'formal', 'evidential', '根拠提示', '事実引用', 'citing fact', 2),
  P('K', '研究によると', ['研究', 'に', 'よる', 'と'], 'utterance-initial', 'formal', 'evidential', '根拠提示', '研究引用', 'citing research', 3),

  // ── K.4 立場表明 (Stance-taking) ───────────────────────
  P('K', '賛成', ['賛成'], 'any', 'neutral', 'agreement', '立場表明', '明示的賛成', 'explicit agreement', 1),
  P('K', '反対', ['反対'], 'any', 'neutral', 'disagreement', '立場表明', '明示的反対', 'explicit opposition', 1),
  P('K', 'どちらかというと', ['どちら', 'か', 'という', 'と'], 'utterance-initial', 'neutral', 'hedge', '立場表明', '控えめな立場', 'tentative stance', 1),
  P('K', '個人的には', ['個人的', 'に', 'は'], 'utterance-initial', 'neutral', 'stance-marking', '立場表明', '個人意見マーカー', 'personal opinion marker', 1),
  P('K', '正直なところ', ['正直', 'な', 'ところ'], 'utterance-initial', 'neutral', 'stance-marking', '立場表明', '率直な意見', 'honest opinion', 1),
  P('K', '敢えて言うなら', ['敢えて', '言う', 'なら'], 'utterance-initial', 'formal', 'stance-marking', '立場表明', '敢えての発言', 'daring to say', 2),
];

// ══════════════════════════════════════════════════════════════
// CATEGORY L: 解説パターン (Explanation/Commentary Patterns)
//   Lecturing, teaching, breaking down concepts.
//   Critical for 解説 genre YouTube content.
// ══════════════════════════════════════════════════════════════

const CAT_L: DiscoursePatternDef[] = [
  // ── L.1 定義・説明 (Definition/Explanation) ────────────
  P('L', 'というのは', ['という', 'の', 'は'], 'utterance-initial', 'neutral', 'definition', '定義', '定義の導入', 'definition introduction', 1),
  P('L', 'いわゆる', ['いわゆる'], 'mid-utterance', 'neutral', 'definition', '定義', 'いわゆる〜', 'so-called', 1),
  P('L', '簡単に言えば', ['簡単', 'に', '言え', 'ば'], 'utterance-initial', 'neutral', 'explanation', '定義', '平易な説明', 'simple explanation', 1),
  P('L', 'ざっくり言うと', ['ざっくり', '言う', 'と'], 'utterance-initial', 'casual', 'explanation', '定義', '概要説明', 'rough explanation', 1),
  P('L', 'わかりやすく言うと', ['わかりやすく', '言う', 'と'], 'utterance-initial', 'neutral', 'explanation', '定義', 'かみ砕いた説明', 'understandable explanation', 2),
  P('L', '何かというと', ['何', 'か', 'という', 'と'], 'utterance-initial', 'neutral', 'definition', '定義', '定義の提示', 'presenting definition', 1),
  P('L', 'どういうことかというと', ['どういう', 'こと', 'か', 'という', 'と'], 'utterance-initial', 'neutral', 'explanation', '定義', '詳細説明の開始', 'starting detailed explanation', 1),

  // ── L.2 比喩・例示 (Analogy/Exemplification) ──────────
  P('L', 'たとえるなら', ['たとえる', 'なら'], 'utterance-initial', 'neutral', 'analogy', '比喩', '比喩の導入', 'analogy introduction', 2),
  P('L', 'イメージとしては', ['イメージ', 'として', 'は'], 'utterance-initial', 'neutral', 'analogy', '比喩', 'イメージ的説明', 'image-based explanation', 1),
  P('L', 'みたいなもの', ['みたい', 'な', 'もの'], 'utterance-final', 'casual', 'analogy', '比喩', '比喩的表現', 'metaphorical expression', 1),
  P('L', 'みたいな感じ', ['みたい', 'な', '感じ'], 'utterance-final', 'casual', 'analogy', '比喩', '曖昧な比喩', 'vague analogy', 1),
  P('L', 'に似ている', ['に', '似て', 'いる'], 'mid-utterance', 'neutral', 'comparison', '比較', '類似の指摘', 'pointing out similarity', 2),
  P('L', 'に例えると', ['に', '例える', 'と'], 'mid-utterance', 'neutral', 'analogy', '比喩', '例えの提示', 'presenting analogy', 2),
  P('L', '逆に言うと', ['逆', 'に', '言う', 'と'], 'utterance-initial', 'neutral', 'contrast', '対比説明', '逆の視点', 'reverse perspective', 1),
  P('L', '言い換えると', ['言い換える', 'と'], 'utterance-initial', 'neutral', 'rephrasing', '対比説明', '言い換え', 'rephrasing', 2),

  // ── L.3 構造提示 (Structuring Explanation) ─────────────
  P('L', 'ここで大事なのが', ['ここ', 'で', '大事', 'な', 'の', 'が'], 'utterance-initial', 'neutral', 'emphasis', '構造提示', '重要点マーク', 'marking important point', 1),
  P('L', '注意してほしいのが', ['注意', 'して', 'ほしい', 'の', 'が'], 'utterance-initial', 'neutral', 'attention', '構造提示', '注意喚起', 'calling attention', 2),
  P('L', 'ポイントがあって', ['ポイント', 'が', 'あっ', 'て'], 'utterance-initial', 'casual', 'topic-initiation', '構造提示', '要点の予告', 'previewing key point', 1),
  P('L', '段階的に見ていくと', ['段階的', 'に', '見て', 'いく', 'と'], 'utterance-initial', 'neutral', 'sequence', '構造提示', '段階的説明の開始', 'starting stepwise explanation', 2),
  P('L', 'まず最初に', ['まず', '最初', 'に'], 'utterance-initial', 'neutral', 'sequence', '構造提示', '第一段階', 'first stage', 1),
  P('L', '次のステップとして', ['次', 'の', 'ステップ', 'として'], 'utterance-initial', 'neutral', 'sequence', '構造提示', '次の段階', 'next step', 2),
  P('L', '最終的には', ['最終的', 'に', 'は'], 'utterance-initial', 'neutral', 'summary', '構造提示', '最終結果', 'final result', 1),
  P('L', 'つまりどういうことか', ['つまり', 'どういう', 'こと', 'か'], 'utterance-initial', 'neutral', 'summary', '構造提示', '要約の開始', 'starting summary', 1),

  // ── L.4 補足・注意 (Supplementary/Caution) ─────────────
  P('L', 'ちなみに', ['ちなみに'], 'utterance-initial', 'neutral', 'digression', '補足', '付随情報', 'supplementary info', 1),
  P('L', '余談ですが', ['余談', 'です', 'が'], 'utterance-initial', 'polite', 'digression', '補足', '脇道情報', 'digression info', 2),
  P('L', 'ただし', ['ただし'], 'utterance-initial', 'neutral', 'concession', '注意', '条件・制限の追加', 'adding condition/limitation', 2),
  P('L', 'ここで注意なのが', ['ここ', 'で', '注意', 'な', 'の', 'が'], 'utterance-initial', 'neutral', 'attention', '注意', '注意点の提示', 'presenting caution', 2),
  P('L', '覚えておいてほしいのが', ['覚えて', 'おいて', 'ほしい', 'の', 'が'], 'utterance-initial', 'neutral', 'emphasis', '注意', '記憶を促す', 'urging to remember', 2),
  P('L', '間違えやすいのが', ['間違え', 'やすい', 'の', 'が'], 'utterance-initial', 'neutral', 'attention', '注意', '誤りやすい点', 'easy-to-mistake point', 2),
];

// ══════════════════════════════════════════════════════════════
// CATEGORY M: 雑談パターン (Casual Chat/Small Talk Patterns)
//   Gossip, storytelling, shared experience, humor.
//   Critical for 雑談 genre YouTube content.
// ══════════════════════════════════════════════════════════════

const CAT_M: DiscoursePatternDef[] = [
  // ── M.1 物語導入 (Story Introduction) ──────────────────
  P('M', 'この前さ', ['この', '前', 'さ'], 'utterance-initial', 'casual', 'narration', '物語導入', '最近の体験談', 'recent personal story', 1),
  P('M', '昨日ね', ['昨日', 'ね'], 'utterance-initial', 'casual', 'narration', '物語導入', '昨日の話', 'yesterday\'s story', 1),
  P('M', '聞いてよ', ['聞いて', 'よ'], 'utterance-initial', 'casual', 'attention', '物語導入', '注意引き', 'attention-getting', 1),
  P('M', '聞いて聞いて', ['聞いて', '聞いて'], 'utterance-initial', 'casual', 'attention', '物語導入', '強い注意引き', 'urgent attention-getting', 1),
  P('M', 'びっくりしたのが', ['びっくり', 'した', 'の', 'が'], 'utterance-initial', 'casual', 'narration', '物語導入', '驚き体験の導入', 'surprising experience intro', 1),
  P('M', '面白い話があって', ['面白い', '話', 'が', 'あっ', 'て'], 'utterance-initial', 'casual', 'narration', '物語導入', '面白い話の導入', 'funny story intro', 1),
  P('M', 'まさかの', ['まさか', 'の'], 'utterance-initial', 'casual', 'surprise', '物語導入', '予想外の展開', 'unexpected development', 1),
  P('M', 'あのね', ['あの', 'ね'], 'utterance-initial', 'casual', 'attention', '物語導入', '話しかけ', 'addressing listener', 1),

  // ── M.2 場面設定 (Scene Setting) ───────────────────────
  P('M', 'あの時さ', ['あの', '時', 'さ'], 'utterance-initial', 'casual', 'scene-setting', '場面設定', '過去の場面設定', 'past scene setting', 1),
  P('M', 'そしたらなんと', ['そしたら', 'なんと'], 'utterance-initial', 'casual', 'narration', '場面設定', '意外な展開', 'surprising turn', 1),
  P('M', 'っていう流れで', ['って', 'いう', '流れ', 'で'], 'utterance-final', 'casual', 'narration', '場面設定', '経緯の説明', 'explaining sequence of events', 1),
  P('M', 'こういう状況で', ['こういう', '状況', 'で'], 'mid-utterance', 'casual', 'scene-setting', '場面設定', '状況説明', 'situation explanation', 1),

  // ── M.3 共感・共有体験 (Empathy/Shared Experience) ─────
  P('M', 'あるある', ['ある', 'ある'], 'utterance-initial', 'casual', 'shared-knowledge', '共感', 'よくある話', 'relatable/common experience', 1),
  P('M', 'わかるわー', ['わかる', 'わー'], 'utterance-initial', 'casual', 'empathy', '共感', '深い共感', 'deep empathy', 1),
  P('M', 'それあるよね', ['それ', 'ある', 'よ', 'ね'], 'utterance-initial', 'casual', 'shared-knowledge', '共感', '共有体験の確認', 'confirming shared experience', 1),
  P('M', 'めっちゃわかる', ['めっちゃ', 'わかる'], 'utterance-initial', 'slang', 'empathy', '共感', '強い共感', 'intense empathy', 1),
  P('M', '自分もそうだった', ['自分', 'も', 'そう', 'だった'], 'utterance-initial', 'casual', 'empathy', '共感', '同じ経験の共有', 'sharing same experience', 1),

  // ── M.4 話題管理（雑談向け） (Topic Management for Chat) ─
  P('M', 'そういえば', ['そういえば'], 'utterance-initial', 'casual', 'topic-shift', '話題転換', '想起的話題転換', 'recall-triggered topic shift', 1),
  P('M', 'それで思い出した', ['それ', 'で', '思い出した'], 'utterance-initial', 'casual', 'topic-shift', '話題転換', '連想的話題転換', 'association-triggered shift', 1),
  P('M', '話変わるけど', ['話', '変わる', 'けど'], 'utterance-initial', 'casual', 'topic-shift', '話題転換', '明示的話題転換', 'explicit topic change', 1),
  P('M', '全然関係ないんだけど', ['全然', '関係', 'ない', 'ん', 'だ', 'けど'], 'utterance-initial', 'casual', 'digression', '話題転換', '脱線の前置き', 'digression preface', 1),
  P('M', '元の話に戻ると', ['元', 'の', '話', 'に', '戻る', 'と'], 'utterance-initial', 'casual', 'return-from-digression', '話題転換', '脱線からの復帰', 'returning from digression', 2),
  P('M', 'で何の話だっけ', ['で', '何', 'の', '話', 'だっけ'], 'utterance-initial', 'casual', 'return-from-digression', '話題転換', '話題復帰の試み', 'attempting topic return', 1),

  // ── M.5 評価・感想 (Evaluation/Impression) ─────────────
  P('M', 'それいいね', ['それ', 'いい', 'ね'], 'utterance-initial', 'casual', 'evaluation', '評価', '肯定的評価', 'positive evaluation', 1),
  P('M', '微妙だよね', ['微妙', 'だ', 'よ', 'ね'], 'utterance-initial', 'casual', 'evaluation', '評価', '曖昧な評価', 'ambiguous evaluation', 1),
  P('M', 'それはちょっと', ['それ', 'は', 'ちょっと'], 'utterance-initial', 'casual', 'evaluation', '評価', '否定的評価', 'negative evaluation', 1),
  P('M', 'めっちゃいい', ['めっちゃ', 'いい'], 'any', 'slang', 'evaluation', '評価', '強い肯定評価', 'strong positive evaluation', 1),
  P('M', '最高', ['最高'], 'any', 'casual', 'evaluation', '評価', '最上級評価', 'highest evaluation', 1),
  P('M', '最悪', ['最悪'], 'any', 'casual', 'evaluation', '評価', '最低評価', 'worst evaluation', 1),

  // ── M.6 自己卑下 (Self-deprecation) ────────────────────
  P('M', '自分が悪いんだけど', ['自分', 'が', '悪い', 'ん', 'だ', 'けど'], 'utterance-initial', 'casual', 'self-deprecation', '自己卑下', '自責の前置き', 'self-blame preface', 1),
  P('M', 'バカだから', ['バカ', 'だ', 'から'], 'utterance-initial', 'casual', 'self-deprecation', '自己卑下', '自虐的理由', 'self-deprecating reason', 1),
  P('M', 'ドジって', ['ドジって'], 'any', 'casual', 'self-deprecation', '自己卑下', '失敗の告白', 'confessing blunder', 2),
];

// ══════════════════════════════════════════════════════════════
// CATEGORY N: 複文構造連鎖 (Complex Sentence Structure "Pieces")
//   Multi-part constructions that span clauses, creating
//   connections that must be tracked across sentence boundaries.
//   These are the "pieces" that connect to form discourse meaning.
// ══════════════════════════════════════════════════════════════

const CAT_N: DiscoursePatternDef[] = [
  // ── N.1 「〜ば〜ほど」型 Correlative Pairs ─────────────
  P('N', 'ば〜ほど', ['ば', 'ほど'], 'mid-utterance', 'neutral', 'cause', '相関構造', '比例関係', 'the more... the more', 2),
  P('N', 'にしても〜にしても', ['にしても', 'にしても'], 'mid-utterance', 'neutral', 'concession', '相関構造', '両方の場合', 'whether... or...', 2),
  P('N', 'にしろ〜にしろ', ['にしろ', 'にしろ'], 'mid-utterance', 'neutral', 'concession', '相関構造', '同上（やや硬い）', 'whether... or... (formal)', 3),
  P('N', 'であれ〜であれ', ['であれ', 'であれ'], 'mid-utterance', 'formal', 'concession', '相関構造', '〜であろうと', 'whether... or... (literary)', 3),

  // ── N.2 条件→帰結の対 (Condition→Consequence Pairs) ───
  P('N', 'もし〜なら', ['もし', 'なら'], 'mid-utterance', 'neutral', 'cause', '条件帰結', '仮定条件', 'hypothetical if...then', 1),
  P('N', 'もし〜たら', ['もし', 'たら'], 'mid-utterance', 'neutral', 'cause', '条件帰結', '仮定条件（口語）', 'hypothetical if...then (spoken)', 1),
  P('N', '仮に〜としても', ['仮', 'に', 'としても'], 'mid-utterance', 'formal', 'concession', '条件帰結', '仮定的譲歩', 'even hypothetically', 2),
  P('N', 'たとえ〜ても', ['たとえ', 'ても'], 'mid-utterance', 'neutral', 'concession', '条件帰結', '逆条件', 'even if', 2),

  // ── N.3 範囲・限定 (Scope/Limitation) ──────────────────
  P('N', 'に限って', ['に', '限って'], 'mid-utterance', 'neutral', 'contrast', '範囲限定', '限定的主張', 'limited to', 2),
  P('N', 'からして', ['から', 'して'], 'mid-utterance', 'neutral', 'evidential', '範囲限定', '〜から判断して', 'judging from', 2),
  P('N', 'に関して言えば', ['に', '関して', '言え', 'ば'], 'mid-utterance', 'neutral', 'topic-initiation', '範囲限定', '〜に限定して', 'speaking of/regarding', 2),
  P('N', 'においては', ['において', 'は'], 'mid-utterance', 'formal', 'topic-initiation', '範囲限定', '〜の場面では', 'in the context of', 3),

  // ── N.4 対比構造 (Contrastive Structures) ──────────────
  P('N', '一方で', ['一方', 'で'], 'utterance-initial', 'neutral', 'contrast', '対比構造', '対比の導入', 'on the other hand', 1),
  P('N', 'に対して', ['に', '対して'], 'mid-utterance', 'neutral', 'contrast', '対比構造', '対比先の指定', 'in contrast to', 2),
  P('N', 'それに対して', ['それ', 'に', '対して'], 'utterance-initial', 'neutral', 'contrast', '対比構造', '前文との対比', 'in contrast to that', 2),
  P('N', '反面', ['反面'], 'mid-utterance', 'neutral', 'contrast', '対比構造', '裏側の提示', 'on the flip side', 2),
  P('N', 'ではなく', ['では', 'なく'], 'mid-utterance', 'neutral', 'contrast', '対比構造', '否定→対比', 'not X but Y', 1),
  P('N', 'じゃなくて', ['じゃ', 'なく', 'て'], 'mid-utterance', 'casual', 'contrast', '対比構造', '否定→対比（口語）', 'not X but Y (spoken)', 1),
  P('N', 'というより', ['という', 'より'], 'mid-utterance', 'neutral', 'rephrasing', '対比構造', '訂正的対比', 'rather than', 1),
  P('N', 'むしろ', ['むしろ'], 'utterance-initial', 'neutral', 'contrast', '対比構造', '逆転の提示', 'rather/instead', 1),

  // ── N.5 累加・並列 (Cumulative/Parallel) ───────────────
  P('N', 'だけでなく', ['だけ', 'で', 'なく'], 'mid-utterance', 'neutral', 'addition', '累加構造', '部分否定→累加', 'not only', 1),
  P('N', 'のみならず', ['のみ', 'ならず'], 'mid-utterance', 'formal', 'addition', '累加構造', 'のみならず…も', 'not only (formal)', 3),
  P('N', 'はもちろん', ['は', 'もちろん'], 'mid-utterance', 'neutral', 'addition', '累加構造', '当然に加えて', 'of course also', 1),
  P('N', 'に加えて', ['に', '加えて'], 'mid-utterance', 'neutral', 'addition', '累加構造', '追加情報', 'in addition to', 2),
  P('N', 'その上', ['その', '上'], 'utterance-initial', 'neutral', 'addition', '累加構造', '更に加えて', 'moreover/on top of that', 2),
  P('N', 'おまけに', ['おまけ', 'に'], 'utterance-initial', 'casual', 'addition', '累加構造', 'その上（口語）', 'on top of that (casual)', 1),
];

// ══════════════════════════════════════════════════════════════
// EXPORT: Combined pattern array, sorted longest-first for
// greedy non-overlapping matching (PR6 approach)
// ══════════════════════════════════════════════════════════════

export const ALL_PATTERNS: DiscoursePatternDef[] = [
  ...CAT_A, ...CAT_B, ...CAT_C, ...CAT_D,
  ...CAT_E, ...CAT_F, ...CAT_G, ...CAT_H, ...CAT_I,
  ...CAT_J, ...CAT_K, ...CAT_L, ...CAT_M, ...CAT_N,
].sort((a, b) => b.tokens.join('').length - a.tokens.join('').length);

/** Index: pattern ID → pattern def */
export const PATTERN_BY_ID: Map<string, DiscoursePatternDef> =
  new Map(ALL_PATTERNS.map(p => [p.id, p]));

/** Index: surface → pattern defs */
export const PATTERNS_BY_SURFACE: Map<string, DiscoursePatternDef[]> = new Map();
for (const p of ALL_PATTERNS) {
  if (!PATTERNS_BY_SURFACE.has(p.surface)) PATTERNS_BY_SURFACE.set(p.surface, []);
  PATTERNS_BY_SURFACE.get(p.surface)!.push(p);
}

/** Index: category → pattern defs */
export const PATTERNS_BY_CATEGORY: Map<PatternCategory, DiscoursePatternDef[]> = new Map();
for (const p of ALL_PATTERNS) {
  if (!PATTERNS_BY_CATEGORY.has(p.category)) PATTERNS_BY_CATEGORY.set(p.category, []);
  PATTERNS_BY_CATEGORY.get(p.category)!.push(p);
}

/** Count per category for stats */
export function getCategoryCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of ALL_PATTERNS) {
    const label = `${p.category}: ${p.categoryLabel}`;
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

/** Total pattern count */
export const PATTERN_COUNT = ALL_PATTERNS.length;

// ── Category display maps (moved here from discourse-grammar so the
//    engine adapter can synthesize defs without a runtime import cycle) ──

export const CATEGORY_LABELS: Record<PatternCategory, string> = {
  A: '発話冒頭表現', B: '発話末表現', C: '論理展開パターン',
  D: '談話境界標識', E: '相互行為的表現', F: 'モダリティ',
  G: '引用・伝聞', H: 'テンス・アスペクト', I: '待遇・レジスター',
  J: 'ツッコミ・反応', K: '討論パターン', L: '解説パターン',
  M: '雑談パターン', N: '複文構造連鎖',
};

export const CATEGORY_COLORS: Record<PatternCategory, string> = {
  A: '#e74c3c', B: '#3498db', C: '#2ecc71', D: '#f39c12',
  E: '#9b59b6', F: '#1abc9c', G: '#e67e22', H: '#34495e', I: '#fd79a8',
  J: '#ff6b6b', K: '#ff9f43', L: '#0984e3', M: '#00b894', N: '#fdcb6e',
};
