// _tmp_pipeline/interaction.mjs
// =====================================================================
// 転換B: interactional 軸 — 実在の相互行為を first-class に扱う。
// ---------------------------------------------------------------------
// 背景 (診断):
//   voicing.mjs の声チャンネル (S / S→H / S→X / S+H) は「一人の語り手が
//   聴き手や人物の声を *演じる*」monologue の修辞的フィクション軸である。
//   しかし実データ (2人 podcast) が必要とするのは別物:
//     ・誰が実際に話したか (speaker)
//     ・直前の発話に対する応答位置 (sequential position)
//     ・その位置で発話が何の相互行為をしているか (interactional act)
//
//   今まで両者を同じ voice フィールドに押し込もうとして双方が中途半端
//   だった。本モジュールは voice を一切触らず、独立した `interaction` 軸を
//   各 utterance に付与する。
//
// 核心 (監査 §4.2 / §4.3 の「同じ表面が位置で別の行為になる」):
//   ・「ですよね」単独 turn          → ALIGN (整列, 何も求めない)
//     「〜ですよね」述語末尾          → CONFIRM-SEEK (聴き手に承認を求める)
//   ・「〜じゃないですか」疑問終止     → CONFIRM-APPEAL (確認)
//     「〜じゃないですか」平叙終止     → GROUND-CLAIM (暗黙同意の地固め)
//   ・「へえ / おお / そうなんだ」     → NEWS-RECEIPT (新情報の受領・状態変化)
//     「うん / はい / そうそう」       → ALIGN / CONTINUER (整列・継続許可)
//   これは表面マーカー単独でなく **sequential position** から確定する。
//   = 構成性原則の対話版。
//
// 出力 (各 sentence.interaction):
//   {
//     move:      'initiate'|'respond'|'follow-up'|'continue',
//     act:       'ADDRESS-SUMMON'|'PROBE'|'INFORM'|'NEWS-RECEIPT'|'ALIGN'|
//                'RATIFY'|'CONFIRM-SEEK'|'CONFIRM-APPEAL'|'GROUND-CLAIM'|'ASSERT',
//     pairPart:  'first'|'second'|null,
//     pairId:    number|null,           // 隣接ペア membership (qa と連携)
//     addressee: string|null,
//     standalone:boolean,               // 1-TCU の最小ターンか
//     evidence:  string[],
//   }
// =====================================================================

// ─────────────────────────────────────────────────────────────────────
// 表面シグナル (これ自体は「位置」と組み合わせて初めて act になる)
// ─────────────────────────────────────────────────────────────────────
const STRIP_RE = /[、。．,.\s「」『』！!？?ー~〜]/g;

// frame 構文族 (叙法核 × 相互行為ベクトル) → 文の operative な相互行為への写像。
// 「わけ」(道理核) と「んです」(説明核) は同型: 文末/節末の核+終助詞が、その発話を
// 語りのどの MOVE にするかを操舵する。同じベクトル(よ/ね/よね/けど/から)が核を横断して
// 働くが、その *force* は核に変調される (move = f(ベクトル, 核)):
//   ・わけ(断定的) + ね → 承認要請 (CONFIRM-SEEK)
//   ・ん  (説明的) + ね → 提示的, act 据え置き (実データ: んですね が へえ で受領される)
// ゆえに hint は role でなく opId 別に調律する。null = frame 注記のみ (base act を尊重)。
// role は talkative なニュアンス注記 (out.frame) で act を潰さず残す。
const FRAME_ROLE = {
  // reason-frame (わけ = 道理核)
  'REASON-GROUND':  'ground',   // わけで(して)  道理→次節への足場
  'REASON-CAUSE':   'cause',    // わけだから    道理→因果前提
  'REASON-CONCEDE': 'concede',  // わけだけど    道理→留保/話題転換
  'REASON-REVEAL':  'reveal',   // わけですよ    道理→開示 (語りの山場)
  'REASON-ALIGN':   'align',    // わけですね    道理→整合要請
  'REASON-STATE':   'state',    // わけです      道理→中立提示
  // explain-frame (の/ん = 説明核)
  'EXPLAIN-CAUSE':   'cause',   // んだから      説明→因果前提
  'EXPLAIN-CONFIRM': 'align',   // んですよね    説明→確認要請
  'EXPLAIN-REVEAL':  'reveal',  // んですよ      説明→開示
  'EXPLAIN-ALIGN':   'align',   // んですね      説明→提示(ね)
  'EXPLAIN-STATE':   'state',   // んです        説明→中立提示
  'EXPLAIN-HEDGE':   'concede', // んですけど    説明→留保/背景projection
  // から-ground 横断: 言い差し因果 (帰結省略) も から ベクトル = 論拠提示。
  'DANGLING-CAUSAL': 'cause',   // んだから。/からね。  懸垂的に論拠だけ置く
  // conjecture-frame (でしょ/だろう = 推量核, 非確言)
  'CONJECTURE-STATE':  'conjecture', // でしょう    婉曲推量提示
  'CONJECTURE-ALIGN':  'align',      // でしょうね  推量+共感seek
  'CONJECTURE-PROBE':  'conjecture', // でしょうか  推量疑問 (act=PROBE は base)
  'CONJECTURE-APPEAL': 'appeal',     // でしょ      推量→確認誘い (act は confirm-tail)
  // quotative-core (って = 引用核) の文末伝聞放り
  'HEARSAY-TOSS':      'toss',       // んだって    伝聞を聴き手に放る (開示的)
};
const FRAME_HINT = {
  // reason-frame: 断定的な「わけ」核は align/concede でも act を動かす
  'REASON-GROUND':  'INFORM',
  'REASON-CAUSE':   'GROUND-CLAIM',
  'REASON-CONCEDE': 'GROUND-CLAIM',
  'REASON-REVEAL':  'INFORM',
  'REASON-ALIGN':   'CONFIRM-SEEK',
  'REASON-STATE':   'INFORM',
  // explain-frame: 説明核は提示的。から(論拠)/よね(確認)のみ act 格上げ。
  // ね(提示的)/けど(背景)/よ(開示)/ø(中立) は frame 注記のみで base act を尊重。
  'EXPLAIN-CAUSE':   'GROUND-CLAIM',
  'EXPLAIN-CONFIRM': 'CONFIRM-SEEK',
  'EXPLAIN-REVEAL':  null,
  'EXPLAIN-ALIGN':   null,
  'EXPLAIN-STATE':   null,
  'EXPLAIN-HEDGE':   null,
  'DANGLING-CAUSAL': 'GROUND-CLAIM',
  // conjecture: 推量核は非確言。act は base 規則 (question→PROBE, confirm-tail→CONFIRM-SEEK)
  // を尊重し、frame note で認識的地位だけ運ぶ (過剰主張回避)。
  'CONJECTURE-STATE':  null,
  'CONJECTURE-ALIGN':  null,
  'CONJECTURE-PROBE':  null,
  'CONJECTURE-APPEAL': null,
  // hearsay-toss: 伝聞放りは開示。base が INFORM のとき据え置き (frame note のみ)。
  'HEARSAY-TOSS':      null,
};

/** 文中で最も後方 (operative) な frame hit を返す。無ければ null。 */
function lastFrame(sentence) {
  const hits = sentence && sentence.hits;
  if (!hits || !hits.length) return null;
  let best = null;
  for (const h of hits) {
    if (!FRAME_ROLE[h.opId]) continue;
    const end = (h.offset ?? 0) + (h.length ?? 0);
    if (!best || end >= best.end) best = { opId: h.opId, end, role: FRAME_ROLE[h.opId], hint: FRAME_HINT[h.opId] };
  }
  return best;
}

/** 純粋な整列トークン (継続許可 / 同意) */
const ALIGN_RE = /^(?:うん|うんうん|うんうんうん|はい|はいはい|はいはいはい|ええ|そう|そうそう|そうそうそう|そうですね|ですね|うむ|まあ)[。．！？\s]*$/;

/** ニュース受領 (状態変化: 新情報を初めて知った) */
const NEWS_RECEIPT_RE = /^(?:へえ|へー|へぇ|ほう|ほー|おお|おー|ふーん|ふうん|なるほど|なるほどなるほど|そっか|そうか|あ、?そうなんだ|そうなんだ|そうなんですか|そうなんですね|知らなかった|知らなかったです|初めて聞き)/;

/** 追認 (情報提供者が受領を受けて「その通り」と固める) */
const RATIFY_RE = /(?:そうなんですよ|そうなんです|そうですそうです|その通り|まさに|おっしゃる通り|そうそうそう)[。．！？\s]*$/;

/** 呼びかけ (vocative) — 次話者を addressee に指名 */
const VOCATIVE_RE = /^([\u4E00-\u9FFFぁ-んァ-ヴーA-Za-z]{1,8})(?:君|さん|先生|ちゃん|くん)[、。．！]/;

/** 疑問終止 */
const QUESTION_RE = /(?:[？?]|ですか[。．！？\s]*$|ますか[。．！？\s]*$|んですか[。．！？\s]*$|の[?？][。．\s]*$|かな[？?]?[。．\s]*$|だろうか[。．\s]*$|でしょうか[。．\s]*$)/;

/** 〜ですよね / 〜よね / 〜でしょ 終止 (述語末尾 = 承認要求) */
// 注: でしょ(上昇・確認) は残し でしょう(下降・推量) は除外。conjecture-frame の
// CONJECTURE-STATE が でしょう を推量提示として捕捉する (CONFIRM-SEEK へ潰さない)。
const CONFIRM_TAIL_RE = /(?:ですよね|だよね|ますよね|よね|でしょ(?!う)|だろ(?!う))[。．！？\s]*$/;

/** 〜じゃないですか / 〜じゃん 終止 */
const APPEAL_TAIL_RE = /(?:じゃないですか|じゃないか|じゃん|ではないですか)[。．！？\s]*$/;

/** 述語を持つか (= 1-TCU 最小ターンでない) の粗判定: 動詞/形容詞/コピュラ終止を含む */
const HAS_PREDICATE_RE = /(?:です|ます|だ|である|た|る|ない|なる|いる|ある|しい|くて|けど|から|ので|んだ|わけ)/;

const norm = t => (t || '').replace(STRIP_RE, '');

/**
 * 単発トークンの種別を返す (位置に依存しない一次分類)。
 */
function lexicalSignal(text) {
  const t = (text || '').trim();
  if (RATIFY_RE.test(t))        return 'ratify';
  if (NEWS_RECEIPT_RE.test(t))  return 'news-receipt';
  if (ALIGN_RE.test(t))         return 'align';
  return null;
}

/**
 * 1 文の interactional act を、文自身の形 + sequential 文脈から確定する。
 *
 * @param {object} sentence  analyzedSentence (text, hits, qa, backchannel 等)
 * @param {object} ctx       {priorOther: 直近の異話者非整列発話 | null,
 *                            priorActBySpeaker: Map, speaker, prevSpeakerAct}
 * @returns {object} interaction
 */
export function classifyAct(sentence, ctx) {
  const out = classifyActBase(sentence, ctx);
  // frame 後処理: 「わけ」/「んです」構文族が発話の operative MOVE を操舵する。
  // 既存の責任ある分類 (vocative/standalone/question/responsive) は尊重し、
  //   ・out.frame に語りのニュアンス (reveal/align/ground/cause/concede/state) を注記
  //   ・hint があり既定 INFORM/ASSERT のときだけ act を格上げ (cause→GROUND-CLAIM 等)
  // これにより核×ベクトルの関係的差 (んですよ=開示 vs んだから=論拠) が下流へ伝わる。
  const rf = lastFrame(sentence);
  if (rf) {
    out.frame = rf.role;
    out.evidence.push(`frame:${rf.opId}`);
    if (rf.hint && (out.act === 'INFORM' || out.act === 'ASSERT')) {
      if (out.act !== rf.hint) {
        out.act = rf.hint;
        if (rf.hint === 'CONFIRM-SEEK') { out.move = 'initiate'; out.pairPart = 'first'; }
        out.evidence.push(`frame-act:${rf.hint}`);
      }
    }
  }
  return out;
}

function classifyActBase(sentence, ctx) {
  const text = sentence.text || '';
  const t = text.trim();
  const stripped = norm(text);
  const evidence = [];

  const isQuestion   = QUESTION_RE.test(t);
  const hasPredicate = HAS_PREDICATE_RE.test(stripped) && stripped.length > 6;
  const signal       = lexicalSignal(text);
  const standalone   = !hasPredicate && (signal != null || !!sentence.backchannel || stripped.length <= 6);

  // 直近に異話者の質問 (FPP) があるか
  const priorOtherQuestion = ctx.priorOther && QUESTION_RE.test((ctx.priorOther.text || '').trim());

  const out = {
    move: 'continue',
    act: 'ASSERT',
    pairPart: null,
    pairId: sentence.qa?.pairId ?? null,
    addressee: null,
    standalone,
    evidence,
  };

  // (1) 呼びかけ — 相互行為の開始, 次話者指名
  const voc = VOCATIVE_RE.exec(t);
  if (voc) {
    out.act = 'ADDRESS-SUMMON';
    out.move = 'initiate';
    out.pairPart = 'first';
    out.addressee = voc[1];
    evidence.push(`vocative:${voc[1]}`);
    return out;
  }

  // (2) 単発トークン (standalone) — 位置で act を確定
  if (standalone) {
    if (priorOtherQuestion) {
      // 質問の後の最小ターン = 第二ペア部 (受領 or 短答)
      out.move = 'respond';
      out.pairPart = 'second';
      out.act = signal === 'news-receipt' ? 'NEWS-RECEIPT' : 'ALIGN';
      evidence.push(`after-question:${signal || 'min'}`);
      return out;
    }
    if (signal === 'ratify') {
      out.move = 'follow-up';
      out.act = 'RATIFY';
      evidence.push('ratify-token');
      return out;
    }
    if (signal === 'news-receipt') {
      // 直前の異話者の情報提供への状態変化受領 = 第二ペア部
      out.move = 'respond';
      out.pairPart = ctx.priorOther ? 'second' : null;
      out.act = 'NEWS-RECEIPT';
      evidence.push('news-receipt-token');
      return out;
    }
    // align / continuer — 整列・継続許可 (何も求めない)。監査 §4.2 #20 の核心:
    // 「ですよね」でも *単独* なら確認要求でなく整列。
    out.move = 'continue';
    out.act = 'ALIGN';
    evidence.push(signal === 'align' ? 'align-token' : 'minimal-turn');
    return out;
  }

  // (3) 述語を持つ発話 — 終止形で位置依存に分岐
  // (3a) じゃないですか: 疑問終止なら確認, 平叙終止なら地固め
  if (APPEAL_TAIL_RE.test(t)) {
    if (isQuestion) {
      out.act = 'CONFIRM-APPEAL';
      out.move = 'initiate';
      out.pairPart = 'first';
      evidence.push('janaidesuka-question');
    } else {
      out.act = 'GROUND-CLAIM';
      out.move = 'initiate';
      evidence.push('janaidesuka-statement-ground');
    }
    return out;
  }

  // (3b) ですよね/よね/でしょ 述語末尾 = 承認要求 (単独整列とは別物)
  if (CONFIRM_TAIL_RE.test(t)) {
    out.act = 'CONFIRM-SEEK';
    out.move = 'initiate';
    out.pairPart = 'first';
    evidence.push('confirm-tail-on-predicate');
    return out;
  }

  // (3c) 疑問終止 = PROBE (情報要求の第一ペア部)
  if (isQuestion) {
    out.act = 'PROBE';
    out.move = 'initiate';
    out.pairPart = 'first';
    evidence.push('question-form');
    return out;
  }

  // (3d) 直前が異話者の PROBE/質問なら INFORM (応答としての情報提供)
  if (priorOtherQuestion) {
    out.act = 'INFORM';
    out.move = 'respond';
    out.pairPart = 'second';
    evidence.push('answer-to-prior-probe');
    return out;
  }

  // (3e) 既定: 平叙の主張 (情報提供)。前話者が同話者なら継続。
  out.act = 'INFORM';
  out.move = ctx.sameAsPrevSpeaker ? 'continue' : 'initiate';
  evidence.push('declarative-assert');
  return out;
}

/**
 * turns (applyDocumentRules 後) を走査し、各 sentence に interaction を付与。
 * PROBE→INFORM→NEWS-RECEIPT→RATIFY の 4 手シーケンスの足場になる。
 *
 * @param {Array<{speaker:string, sentences:any[]}>} turns
 * @returns {Array<{speaker:string, sentences:any[]}>} turns (in-place 更新)
 */
export function assignInteraction(turns) {
  if (!turns || !turns.length) return turns;
  // flat 走査列を作る (turn 境界を跨いで「直近の異話者発話」を引く)
  const flat = [];
  for (let ti = 0; ti < turns.length; ti++) {
    for (const s of turns[ti].sentences) {
      flat.push({ s, speaker: turns[ti].speaker, ti });
    }
  }

  let prevSpeaker = null;
  for (let i = 0; i < flat.length; i++) {
    const { s, speaker } = flat[i];
    // 直近の「異話者の非整列発話」を遡って探す (整列トークンは応答先にならない)
    let priorOther = null;
    for (let j = i - 1; j >= 0 && j >= i - 12; j--) {
      if (flat[j].speaker === speaker) continue;
      const pt = flat[j].s;
      // 整列トークンは「応答先」ではないのでスキップ
      if (lexicalSignal(pt.text) === 'align') continue;
      priorOther = pt;
      break;
    }
    const ctx = {
      priorOther,
      speaker,
      sameAsPrevSpeaker: prevSpeaker === speaker,
    };
    s.interaction = classifyAct(s, ctx);
    prevSpeaker = speaker;
  }
  return turns;
}

/**
 * 文書全体の相互行為プロファイル (監査が言う「対話 first の分析」用サマリ)。
 */
export function interactionProfile(turns) {
  const actCounts = {};
  const moveCounts = {};
  let total = 0;
  for (const t of turns) for (const s of t.sentences) {
    const it = s.interaction;
    if (!it) continue;
    total++;
    actCounts[it.act]  = (actCounts[it.act]  || 0) + 1;
    moveCounts[it.move] = (moveCounts[it.move] || 0) + 1;
  }
  return { total, actCounts, moveCounts };
}
