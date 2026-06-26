// _tmp_pipeline/postpose.mjs
// L4.5: 後置・倒置・言いさし検出 — 文として独立しているように見えても、
// 述語を欠く / 主題後置 / 残余要素として直前文に attach すべきものを発見する。
//
// 設計原理:
//   - sentencize は形式的にしか文を切らない。話者は倒置や後置を多用する。
//   - 「ヘンデルさんは。」のような NP のみで終わる短文は、直前主節への後置補完。
//   - 「言いさし」(けど。/けどね。 で終わって続かない) は、直前主節と並ぶ別の発話。
//   - 関係種別:
//       postpose-subject   : 主語/主題の後置
//       postpose-object    : 目的語の後置
//       postpose-adjunct   : 副詞/補語の後置
//       trailing-vantage   : 視座タグ(けどね/からね 単独短文)
//       afterthought       : 思いついた付け足し
//       concession-trail   : 譲歩の引きずり
//
// 公開: postposeDocument(sentences), classifyFragment(sentence)

const PUNCT_END = /[。．！？]/;
const PARTICLES_END = /(よ|ね|よね|わ|さ|ぞ|ぜ|な|か|かな|から|けど|けども|けれども|のに|から|ので)$/;
const HAS_PREDICATE = /(です|ます|だ|ない|た|る|う|ょう|ましょう|でしょう|でした|ました|よう|たい|られ|せる|させる|なさい|くだ)[。．！？]?$/;
const NOMINAL_ONLY  = /^[、，]?\s*[一-龥ぁ-んァ-ヶー]+(?:[はがをにでとへもや])?[。．！？]?$/;

function strip(s) { return (s || '').replace(/[。．！？\s]+$/, ''); }

// --- 単文分類 (fragment kind) -----------------------------
/**
 * 文を「完結文 / 後置補完候補 / 言いさし / 視座タグ / その他 fragment」に分類。
 * @param {{text: string}} sentence
 */
export function classifyFragment(sentence) {
  const text = (sentence.text || '').trim();
  const body = strip(text);

  // 0. 短すぎる / 空
  if (body.length === 0) return { kind: 'empty' };
  if (body.length <= 2 && !PARTICLES_END.test(body)) return { kind: 'micro', body };

  // 1. 述語/モダリティ末尾を持つか
  const hasPred = HAS_PREDICATE.test(text);

  // 2. 言いさし (けど。/けどね。/けどよ。/けれど。)
  if (/^(.{2,})(けど|けども|けれど|けれども)(ね|よ|さ|わ)?[。．！？]?$/.test(text)) {
    return { kind: 'trailing-vantage-kedo', body, subtype: 'kedo' };
  }

  // 3. 視座タグ (からね/からよ/からさ で終わる短文)
  if (/^(.{1,})(から)(ね|よ|さ|わ)?[。．！？]?$/.test(text) && text.length < 20) {
    return { kind: 'trailing-vantage-kara', body, subtype: 'kara' };
  }

  // 4. 述語あり → 完結文 (倒置末尾は除外: 「これは。」のように主題助詞のみで終わるもの)
  //    ※述語チェックは NP のみ判定より先にやる
  if (hasPred) return { kind: 'complete', body };

  // 5. NP のみ (主題/目的後置候補) — 述語がない場合のみ
  if (NOMINAL_ONLY.test(body) && body.length < 16) {
    // 助詞種別で attach 種別を分ける
    let attach = 'postpose-adjunct';
    if (/(は|って)$/.test(body)) attach = 'postpose-subject';
    else if (/を$/.test(body)) attach = 'postpose-object';
    else if (/(に|で|と|へ|から)$/.test(body)) attach = 'postpose-adjunct';
    else attach = 'afterthought';   // 助詞なし NP
    return { kind: attach, body };
  }

  // 6. その他 fragment
  return { kind: 'open-fragment', body };
}

// --- attach 候補先を直前主節から探す ------------------------
function findAttachTarget(sentences, idx) {
  for (let j = idx - 1; j >= Math.max(0, idx - 3); j--) {
    const prev = sentences[j];
    const klass = prev._fragmentClass;
    if (klass && klass.kind === 'complete') return prev;
    // 完結でなくても直前があれば一段だけ許す
    if (j === idx - 1) return prev;
  }
  return null;
}

// --- 文書に貼る ----------------------------------
export function postposeDocument(sentences) {
  // 1. 各文を分類
  for (const s of sentences) {
    s._fragmentClass = classifyFragment(s);
  }
  // 2. fragment を直前主節に attach
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const klass = s._fragmentClass;
    if (!klass) continue;
    if (klass.kind === 'complete' || klass.kind === 'empty' || klass.kind === 'micro') continue;

    const target = findAttachTarget(sentences, i);
    if (!target) continue;

    const rel = {
      from: s.idx ?? i,
      to:   target.idx ?? (i - 1),
      relation: klass.kind,
      body: klass.body,
      subtype: klass.subtype || null,
    };
    s.postpose = rel;

    // target 側に attached リストを足す
    if (!target.attached) target.attached = [];
    target.attached.push(rel);
  }
  return sentences;
}

// --- 公開: 統計 (テスト用) -----------------------
export function postposeStats(sentences) {
  const counts = {};
  for (const s of sentences) {
    const k = s._fragmentClass?.kind || 'unknown';
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}
