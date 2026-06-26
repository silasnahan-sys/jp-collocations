// _tmp_pipeline/voicing.mjs
// L2 + L3:声チャンネル付与 と 想像引用類型分類。
//
// 声チャンネルの語彙:
//   'S'    語り手の地の声
//   'S→H'  語り手が演じる「聴き手の予期/前提」(召喚)
//   'S→X'  語り手が演じる「人物Xの心内・発話」(伝記引用)
//   'S+H'  語り手と聴き手の同席空間(ね・じゃないですか系)
//
// 想像引用類型:
//   'quote.attributed'        第三者の発話/思考(評語動詞付き)
//   'quote.evoked-assumption' 聴き手の予期を召喚(直後に破棄/追認待ち)
//   'quote.suspended'         評語抜きで聴き手に手渡し(伝記的事実)
//   'quote.self-thought'      語り手自身の思考(と思う 等)
//   null                       引用ではない

/** opId → デフォルト声候補(後段の文脈ルールで一つに確定) */
const VOICE_DEFAULTS = new Map(Object.entries({
  // 単独では地の声 S。hinge と密集したときのみルール A で召喚 (P0.4)。
  'TEMPORAL-NOW':        ['S', 'S→H', 'S+H'],
  'EXPECTATION-CONFIRM': ['S', 'S→H', 'S+H'],
  // STANCE-PACKAGE は「もう ∧ やはり」の複合自体が召喚 signature なので S→H 先頭で OK
  'STANCE-PACKAGE':      ['S→H', 'S+H', 'S'],
  'GROUND-CLAIM':        ['S+H', 'S→H'],            // じゃないですか
  // 同席空間を作る粒子・ヘッジ
  'TOPIC-STAGE-MARK':    ['S+H', 'S'],              // 〜はね/さ
  'FILLER-HESITATION':   ['S+H', 'S'],              // あの、えーと
  // 願望・心内・依頼:三人称主語が見えれば S→X、自分なら S→自身
  'EPISTEMIC-THINK':     ['S', 'S→X'],              // と思う
  'EPISTEMIC-EXPECT':    ['S', 'S→X'],
  'EPISTEMIC-MAY':       ['S'],
  // 引用マーカー:中身の声は別途決定
  'QUOTATIVE-ATTRIB':    ['S'],                     // 「と」自体は地の声、中身が別声
  'QUOTATIVE-SPEECH':    ['S'],
  // 伝聞は他者声を運ぶが包む声は S
  'EVIDENTIAL-HEARSAY':  ['S→X', 'S'],
  // 説明・視座導入系は基本 S
  'PERSPECTIVE-STAGE-OPEN': ['S'],
  'EXPLAIN-NOMINAL':     ['S'],
  // 既定が S のものは省略(明示しない hit は S)
}));

/** 三人称主語っぽい名詞(将来は固有名詞抽出に置き換え) */
const THIRD_PERSON_HEAD = /(?:お父さん|お母さん|父|母|先生|社長|友達|彼|彼女|[一-龥ァ-ヶー]{2,}さん|[A-Za-zＡ-Ｚａ-ｚ一-龥ァ-ヶー]+(?:氏|君|くん|ちゃん))/;

/** 一人称マーカー */
const FIRST_PERSON = /(?:私(?:は|が|の)?|僕(?:は|が|の)?|俺(?:は|が|の)?|うち(?:は|が)?|あたし)/;

/** 願望・心内述語(末尾位置) */
const WISH_PRED   = /(?:てほしい|てほしかった|たい|たかった)/;
const THOUGHT_PRED = /(?:と思う|と思った|と考える|と考えた|と感じる|と感じた)/;

/** 評語動詞(引用閉じ) */
const QUOTE_CLOSER = /(?:と)(?:言|思|考|話|述|述べ|語|答|問|尋|聞|書|記|示|伝|呟|つぶや|叫|怒鳴)/;

/**
 * 各 hit に voicing を付与する(in-place ではなく新しい hit 配列を返す)。
 * @param {string} text 文テキスト
 * @param {Array<any>} hits  既存の hit 配列
 * @returns {Array<any>}
 */
export function assignVoicing(text, hits) {
  // 1) デフォルト声を割当
  const out = hits.map(h => {
    const d = pickDefaultVoice(h);
    return {
      ...h,
      voice: d.voice,
      // 'lexicon' = VOICE_DEFAULTS に登録された声 / 'fallback' = 根拠なく地の声 S に落ちた未知
      voiceConfidence: d.source,
      voiceEvidence: [],
    };
  });

  // 2) 文脈ルールで上書き
  applyEvokedAssumptionRule(text, out);
  applySharedSpaceRule(text, out);
  applyWishAttributionRule(text, out);
  applyThoughtSelfRule(text, out);

  return out;
}

function pickDefaultVoice(h) {
  const cand = VOICE_DEFAULTS.get(h.opId);
  if (cand && cand.length) return { voice: cand[0], source: 'lexicon' };
  return { voice: 'S', source: 'fallback' };
}

/**
 * ルール A:聴き手予期の召喚 (P0.4 で AND 化)
 *   「もう ∧ やはり/やっぱり」 もしくは複合 STANCE-PACKAGE が
 *   hinge(CONCESSIVE-CONTRAST / EXPLAIN-NOMINAL)より前に存在し、
 *   かつ hinge が後続する場合のみ、その密集領域を S→H に染める。
 *   旧仕様(単独 TEMPORAL-NOW でも召喚)は誤陽性が多すぎたため廃止。
 */
function applyEvokedAssumptionRule(text, hits) {
  const hinge = hits.find(h =>
    h.opId === 'CONCESSIVE-CONTRAST' || h.opId === 'EXPLAIN-NOMINAL'
  );
  if (!hinge) return;
  const leftOfHinge = hits.filter(h => h.offset < hinge.offset);
  const hasNow     = leftOfHinge.some(h => h.opId === 'TEMPORAL-NOW');
  const hasConfirm = leftOfHinge.some(h => h.opId === 'EXPECTATION-CONFIRM');
  const hasPackage = leftOfHinge.some(h => h.opId === 'STANCE-PACKAGE');
  const triggered  = hasPackage || (hasNow && hasConfirm);
  if (!triggered) return;
  // 召喚の対象は密集している予期系オペレーターのみ。GROUND-CLAIM は単独では弱いので含めない。
  const candidates = leftOfHinge.filter(h =>
    h.opId === 'TEMPORAL-NOW' ||
    h.opId === 'EXPECTATION-CONFIRM' ||
    h.opId === 'STANCE-PACKAGE'
  );
  for (const h of candidates) {
    h.voice = 'S→H';
    h.voiceConfidence = 'rule';
    h.voiceEvidence.push(
      `evoked-by-hinge:${hinge.opId}@${hinge.offset}` +
      `[${hasPackage ? 'STANCE-PACKAGE' : 'NOW+CONFIRM'}]`
    );
  }
}

/**
 * ルール B:同席空間
 *   ね・よね・でしょ・じゃないですか が末尾近傍にあるとき、
 *   その文全体の末尾近傍 hit を S+H に染める。
 */
function applySharedSpaceRule(text, hits) {
  const tail = text.replace(/[。．！？!?\s]+$/, '');
  const tailZone = Math.max(0, tail.length - 8);
  const hasShared = /(?:ね|よね|でしょ|じゃないですか|ですよね)[。．！？!?\s]*$/.test(text);
  if (!hasShared) return;
  for (const h of hits) {
    if (h.offset >= tailZone && h.voice === 'S') {
      h.voice = 'S+H';
      h.voiceConfidence = 'rule';
      h.voiceEvidence.push('tail-shared-particle');
    }
  }
}

/**
 * ルール C:願望の主体帰属
 *   「[人物名]に〜てほしい」 → ほしい節の中身は S→[人物]。
 *   人物名は QUOTATIVE-ATTRIB(と) の左側の文字列から抽出。
 */
function applyWishAttributionRule(text, hits) {
  const wish = WISH_PRED.exec(text);
  if (!wish) return;
  const wishStart = wish.index;
  // 主語候補:文頭〜wishStart の間で最も右にある三人称名詞
  const slice = text.slice(0, wishStart);
  const persons = [...slice.matchAll(new RegExp(THIRD_PERSON_HEAD, 'g'))];
  if (!persons.length) return;
  const subject = persons[persons.length - 1][0];
  // 願望節内の hit を S→[subject] に
  let touched = 0;
  for (const h of hits) {
    if (h.offset >= wishStart - 30 && h.offset <= wishStart + wish[0].length) {
      h.voice = `S→${subject}`;
      h.voiceConfidence = 'rule';
      h.voiceEvidence.push(`wish-attributed-to:${subject}`);
      touched++;
    }
  }
  // 既存 hit が無ければ仮想 wish-hit を挿入(L4 evocation/decompose で拾えるよう)
  if (touched === 0) {
    hits.push({
      opId: 'WISH-ATTRIB',
      surface: wish[0],
      offset: wishStart,
      length: wish[0].length,
      voice: `S→${subject}`,
      voiceConfidence: 'rule',
      voiceEvidence: [`wish-attributed-to:${subject}`],
      virtual: true,
    });
    hits.sort((a, b) => a.offset - b.offset);
  }
}

/**
 * ルール D:と思う系は語り手自身の思考
 *   「〜と思う・考える」が末尾にある場合、その「と」を含む引用節は S→self
 *   (=S と区別したい場合は 'S-thought')。本実装では S のまま、quoteType を立てる。
 */
function applyThoughtSelfRule(text, hits) {
  if (!THOUGHT_PRED.test(text)) return;
  if (FIRST_PERSON.test(text)) {
    for (const h of hits) {
      if (h.opId === 'QUOTATIVE-ATTRIB' || h.opId === 'EPISTEMIC-THINK') {
        h.voiceEvidence.push('self-thought-context');
      }
    }
  }
}

/* ---------------------------------------------------------------- *
 * L3: 想像引用類型分類器
 * ---------------------------------------------------------------- */

/**
 * 文中の「と / という」各出現を四類型に分類する。
 * @param {string} text
 * @param {Array<any>} hits  voicing 済み hits
 * @returns {Array<{offset:number, length:number, surface:string, type:string, evidence:string[]}>}
 */
export function classifyQuotes(text, hits) {
  const results = [];
  const seen = new Set();
  // テキスト直走査:「という」「っていう」「と」「って」全てを引用マーカー候補にする
  const re = /(?:っていう|という|って|と)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const offset = m.index;
    const surface = m[0];
    if (seen.has(offset)) continue;
    // 助詞「と」誤検出ガード:直前が漢字/カナ/かな以外(数字や記号)なら飛ばす
    if (surface === 'と' && offset > 0) {
      const prev = text[offset - 1];
      if (/[0-9０-９\s]/.test(prev)) continue;
    }
    seen.add(offset);
    const r = classifyOneQuote(text, hits, offset, surface.length, surface);
    if (r) results.push(r);
  }
  return results;
}

function classifyOneQuote(text, hits, offset, length, surface) {
  const evidence = [];
  const stop = offset + length;
  const after = text.slice(stop).replace(/^[、，。．！？\s]+/, '');
  const endTrim = text.replace(/[。．！？!?\s]+$/, '');
  const isFinal = stop >= endTrim.length;

  // (pre-a) PERSPECTIVE-STAGE-OPEN(視座導入)の一部なら quote ではない
  //   「っていうのは」「というのが」「とのを」など → っていう/という/と/って + の + (は/が/を/名詞)
  if (/^の(?:は|が|を|に|も|で|[一-龥ァ-ヶー])/.test(after)) {
    return null;
  }

  // (a) 自己思考?
  if (/^(?:思う|思った|思って|思っ|思います|思いました|考える|考えた|考えて|考えっ)/.test(after) ||
      hits.some(h => h.opId === 'EPISTEMIC-THINK' && Math.abs(h.offset - stop) <= 3)) {
    evidence.push('thought-closer');
    return { offset, length, surface, type: 'quote.self-thought', evidence };
  }

  // (b) 評語動詞で閉じる?
  //   (b0) マーカー直後(after)が評語動詞で始まれば、と/って どちらでも attributed。
  //        QUOTE_CLOSER は「と+評語」しか見ず「って言って」を取りこぼしていた穴を塞ぐ。
  const REPORT_HEAD = /^(?:言|話|述|語|答|問|尋|聞|書|記|示|伝|呟|つぶや|叫|怒鳴)/;
  if (REPORT_HEAD.test(after)) {
    evidence.push(`attributed-report-verb:${after.slice(0, 2)}`);
    return { offset, length, surface, type: 'quote.attributed', evidence };
  }
  const closerMatch = text.slice(Math.max(0, offset - 1)).match(QUOTE_CLOSER);
  if (closerMatch && !isFinal) {
    evidence.push(`attributed-closer:${closerMatch[0]}`);
    return { offset, length, surface, type: 'quote.attributed', evidence };
  }
  // 「と言われている」「と書いてある」など受動の閉じも attributed 扱い
  if (/^(?:言われ|書かれ|記され|呼ばれ|思われ|考えられ)/.test(after)) {
    evidence.push('attributed-passive-closer');
    return { offset, length, surface, type: 'quote.attributed', evidence };
  }

  // (c) 召喚された前提? — 中身に S→H の voicing がある & 文中央
  const insideStart = Math.max(0, offset - 25);
  const insideHits = hits.filter(h => h.offset >= insideStart && h.offset < offset);
  const hasEvoked = insideHits.some(h => h.voice === 'S→H');
  if (hasEvoked && !isFinal) {
    evidence.push('evoked-content-precedes');
    return { offset, length, surface, type: 'quote.evoked-assumption', evidence };
  }

  // (d) 末尾「と。」で評語なし → 宙吊り
  if (isFinal) {
    evidence.push('sentence-final-no-closer');
    return { offset, length, surface, type: 'quote.suspended', evidence };
  }

  // (e) その他 — 「と」「って」単独で根拠なしは動詞 te 形/並列助詞として捨てる
  if (surface === 'って' || surface === 'と') return null;
  evidence.push('default-attributed');
  return { offset, length, surface, type: 'quote.attributed', evidence };
}
