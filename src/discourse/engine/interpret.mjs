// _tmp_pipeline/interpret.mjs
// =====================================================================
// L7.5 + L7.6 + L4.5 統合層
//   L7.5: 命題的読み (topic / claim / contrast / suspended / attribution / echoes)
//   L7.6: 包み(envelope) — sense lattice による話者スタンス
//   L4.5: 後置・倒置・言いさし(postpose) — fragment を直前文に attach
//
// 旧称 L7.5: CONTEXTUAL INTERPRETATION LAYER
// ---------------------------------------------------------------------
// 既存層は「文法操作子と構造スロット」を抽出するが、それらが何の命題内容
// の上で作用しているかを陽に取り出していなかった。
// この層は parts[i].content から軽量に命題を抽出し、
//   - topic        : 定義文の主題 (「ヘンデル」)
//   - evokedFrame  : 召喚された共有前提 (cue + target 命題)
//   - claim        : 主張の {subject, predicate, modality}
//   - contrast     : ピボット左右の命題対
//   - attribution  : 願望/発話の帰属者
//   - suspended    : 宙吊りに残された命題
//   - semanticEchoes: 先行文の主題/述語の再活性化
// を sentence.reading に貼る。各 hit にも contextualEffect を後付け。
// =====================================================================

import { envelopeDocument } from './envelope.mjs';
import { postposeDocument } from './postpose.mjs';

const TRIM_LEAD = /^[、，。．\s「『]+/;
const TRIM_TAIL = /[、，。．！？\s」』]+$/;
const trim = s => (s == null ? '' : String(s).replace(TRIM_LEAD, '').replace(TRIM_TAIL, ''));

const DEFINITION_TAIL =
  /(?:っていうのは|というのは|っていうのが|というのが|っていうのを|というのを|っていうの|というの|っての|とのは|って|は|が)/;

/** 「ヘンデルっていうのは、」→ "ヘンデル" を抜き出す */
function extractTopic(setupContent) {
  const t = trim(setupContent);
  if (!t) return null;
  const m = t.match(new RegExp('^(.{1,20}?)' + DEFINITION_TAIL.source));
  if (m && m[1]) return m[1];
  return t.slice(0, 20);
}

/**
 * 「お父さんは法律家になってほしい」→ {subject:"お父さん", predicate:"法律家になってほしい", modality:"wish"}
 * パーサが無いので、最初の「は/が/も」助詞で主語を切り、末尾の活用パターンで modality を推定。
 */
function parseClause(text) {
  const t = trim(text);
  if (!t) return null;
  let subject = null;
  let rest = t;
  // 主語候補:文頭〜18字以内に は/が/も
  const m = t.match(/^([^、，]{1,20}?)(は|が|も)/);
  if (m) { subject = m[1]; rest = t.slice(m[0].length); }
  rest = rest.replace(/^[、，]+/, '');

  let modality = null;
  if (/(?:てほしい|てほしかった|ほしい|ほしかった)$/.test(rest))      modality = 'wish';
  else if (/(?:と思う|と思います|と思った|と思いました)$/.test(rest))  modality = 'epistemic-think';
  else if (/(?:だろう|でしょう|かもしれない|かもしれません|かも)$/.test(rest)) modality = 'epistemic-may';
  else if (/(?:なきゃ|なきゃいけない|べき|ねばならない|しなければ)$/.test(rest)) modality = 'deontic';
  else if (/(?:じゃないですか|だよね|ですよね|よね)$/.test(rest))      modality = 'ground-claim';
  else if (/(?:ました|ます|でした|です|だった|た|だ|である|であった)$/.test(rest)) modality = 'declarative';
  else if (/(?:てる|ている|ていた|てた)$/.test(rest))                  modality = 'progressive';
  else                                                                  modality = 'open';

  return { subject, predicate: rest, modality, raw: t };
}

/** 「召喚されている対象命題」を、evocation 部の周辺テキストから抽出 */
function findEvokedTarget(text, parts, evoc, pivot) {
  // 優先: evoc.end〜(次のピボット/句点)までの raw text を target とみなす
  //   これは parts に出ない「ギャップ領域」(例: 「音楽に興味があった」) を拾う
  const start = evoc.end;
  let end = text.length;
  if (pivot && pivot.anchor?.offset > start) end = pivot.anchor.offset;
  else {
    // 次の comma / 句点まで
    const slice = text.slice(start);
    const m = slice.search(/[、，。．！？]/);
    if (m > 0) end = start + m;
  }
  const target = trim(text.slice(start, end));
  if (target && target.length >= 2) return target;
  // フォールバック: 直後の claim/setup 部
  const after = parts.filter(p =>
    p.start >= evoc.end && p.label !== 'pivot' && p.label !== 'suspended' && p.label !== 'evocation'
  );
  if (after[0]) return trim(after[0].content);
  return null;
}

/** ピボットの左右テキストを raw text の offset 範囲から取り出す */
function findPivotSides(text, parts, pivot) {
  const off = pivot.anchor?.offset ?? 0;
  const len = pivot.anchor?.length ?? 0;
  // 左辺: 文頭〜ピボット直前(setup/evocation/ギャップ全てを含む)
  // ただし、setup の DEFINITION-OPEN 末尾までは「主題提示」なので除外し、それ以降を「対立左辺」とする
  const setup = parts.find(p => p.label === 'setup');
  const leftStart = setup ? setup.end : 0;
  const leftText  = trim(text.slice(leftStart, off));
  // 右辺: ピボット直後〜文末手前(suspended の「と」は除外)
  const sus = parts.find(p => p.label === 'suspended');
  const rightEnd = sus ? sus.start : text.length;
  const rightText = trim(text.slice(off + len, rightEnd));
  return { leftText, rightText };
}

/** 単文の文脈意味読みを構築 */
export function interpretSentence(sentence) {
  const parts = sentence.parts || [];
  const reading = {
    topic: null,
    evokedFrame: null,
    claim: null,
    contrast: null,
    attribution: null,
    suspended: null,
    interrogation: false,
    backchannel: null,
    semanticEchoes: null,
  };

  const setup = parts.find(p => p.label === 'setup');
  if (setup) reading.topic = extractTopic(setup.content);

  const claimPart = parts.find(p => p.label === 'claim');
  if (claimPart) reading.claim = parseClause(claimPart.content);

  const evoc = parts.find(p => p.label === 'evocation');
  const pivot = (sentence.pivots || [])[0];
  if (evoc) {
    reading.evokedFrame = {
      cue: trim(evoc.content),
      voice: evoc.voice || null,
      target: findEvokedTarget(sentence.text, parts, evoc, pivot),
    };
  }

  const sus = parts.find(p => p.label === 'suspended');
  if (sus) {
    const prop = reading.claim?.raw || null;
    reading.suspended = { proposition: prop, wisher: null };
    if (reading.claim?.modality === 'wish' && reading.claim?.subject) {
      reading.suspended.wisher = reading.claim.subject;
      reading.attribution = {
        who: reading.claim.subject,
        what: reading.claim.predicate,
        modality: 'wish',
      };
    }
  }

  if (pivot && /CONCESSIVE|CONTRAST|逆接/.test(pivot.opId + (pivot.intent || ''))) {
    const { leftText, rightText } = findPivotSides(sentence.text, parts, pivot);
    reading.contrast = {
      pivotOp: pivot.opId,
      pivotSurface: pivot.anchor?.surface || '',
      left: leftText || null,
      right: rightText || null,
      leftProp: leftText ? parseClause(leftText) : null,
      rightProp: rightText ? parseClause(rightText) : null,
    };
  }

  const txt = trim(sentence.text);
  if (/[?？]$/.test(txt) || /(?:でしょうか|ですか|だろうか|かな|の[?？])$/.test(txt)) {
    reading.interrogation = true;
  }
  if (txt.length < 14 && /^(?:うん|はい|ええ|そう|そっか|なるほど|あー|あ、|あ ?そう)/.test(txt)) {
    reading.backchannel = txt;
  }

  return reading;
}

/** 各 hit に「ここで実際に何の上に作用しているか」の contextual gloss を貼る */
export function annotateHitsWithContextualEffect(sentence, reading) {
  if (!sentence?.hits) return;
  for (const h of sentence.hits) {
    let txt = null;
    switch (h.opId) {
      case 'DEFINITION-OPEN':
        if (reading.topic) txt = `主題「${reading.topic}」を定義文の対象に据える`;
        break;
      case 'TEMPORAL-NOW':
        if (reading.evokedFrame?.target)
          txt = `『${reading.evokedFrame.target}』を「いま既に」の時点に固定`;
        else txt = `時点を「いま既に」へ固定`;
        break;
      case 'EXPECTATION-CONFIRM':
        if (reading.evokedFrame?.target)
          txt = `『${reading.evokedFrame.target}』を聞き手も予期済みの共通了解として刻印`;
        else txt = `予期通りであることを共通了解として刻印`;
        break;
      case 'CONCESSIVE-CONTRAST':
        if (reading.contrast?.left && reading.contrast?.right)
          txt = `『${reading.contrast.left}』に対し『${reading.contrast.right}』へ反転`;
        else txt = `前提を一旦認めて反対方向へ転じる`;
        break;
      case 'WISH-MODAL':
        if (reading.attribution)
          txt = `${reading.attribution.who}の願望「${reading.attribution.what}」として帰属`;
        else txt = `願望として陳述`;
        break;
      case 'QUOTATIVE-ATTRIB':
        if (reading.suspended?.proposition)
          txt = `『${reading.suspended.proposition}』を引用閉じ動詞なしで宙吊りに残す`;
        break;
      case 'STANCE-PACKAGE':
        if (reading.evokedFrame?.target)
          txt = `『${reading.evokedFrame.target}』を「君も既に知っているはずだよね」枠で聞き手に同意を予め買い込む`;
        break;
      case 'TYPE-FRAME-CONFIRMED':
        if (reading.topic && reading.evokedFrame?.target)
          txt = `「${reading.topic}」について『${reading.evokedFrame.target}』を共有前提として書き込む`;
        break;
    }
    if (txt) h.contextualEffect = txt;
  }
}

/** 跨文 echoes:直近4文に同一トークンの再活性化があるか */
export function attachCrossThoughtLinks(sentences) {
  const tokensOf = (r) => {
    const s = new Set();
    if (!r) return s;
    if (r.topic) s.add(r.topic);
    if (r.claim?.subject) s.add(r.claim.subject);
    if (r.claim?.predicate) {
      const m = r.claim.predicate.match(/[一-龥ァ-ヶー]{2,8}/g);
      if (m) for (const x of m) s.add(x);
    }
    if (r.contrast?.left)  { const m = r.contrast.left.match(/[一-龥ァ-ヶー]{2,8}/g);  if (m) for (const x of m) s.add(x); }
    if (r.contrast?.right) { const m = r.contrast.right.match(/[一-龥ァ-ヶー]{2,8}/g); if (m) for (const x of m) s.add(x); }
    return s;
  };
  const STOP = new Set(['こと', 'もの', 'これ', 'それ', 'あれ', 'よう', 'ため']);

  const allTokens = sentences.map(s => tokensOf(s.reading));
  for (let i = 1; i < sentences.length; i++) {
    const cur = allTokens[i];
    if (!cur.size) continue;
    const echoes = [];
    for (let j = Math.max(0, i - 4); j < i; j++) {
      const prev = allTokens[j];
      for (const t of cur) {
        if (t.length < 2 || STOP.has(t)) continue;
        if (prev.has(t)) echoes.push({ token: t, fromSent: j });
      }
    }
    if (echoes.length) {
      // dedupe by token, keep nearest
      const byTok = new Map();
      for (const e of echoes) {
        const prev = byTok.get(e.token);
        if (!prev || prev.fromSent < e.fromSent) byTok.set(e.token, e);
      }
      sentences[i].reading.semanticEchoes = [...byTok.values()].slice(0, 4);
    }
  }
}

/** 文書全体に reading を貼る */
export function interpretDocument(sentences) {
  // L7.6 envelope (sense lattice)
  envelopeDocument(sentences);
  // L4.5 postpose (倒置/言いさしの attach)
  postposeDocument(sentences);
  for (const s of sentences) {
    s.reading = interpretSentence(s);
    // envelope.stance / postpose.attached を reading にも入れて narrate/dashboard から見やすく
    if (s.envelope) s.reading.envelope = s.envelope.stance;
    if (s.postpose) s.reading.postposedTo = s.postpose.to;
    if (s.attached?.length) s.reading.attachedFrom = s.attached.map(a => a.from);
    annotateHitsWithContextualEffect(s, s.reading);
  }
  attachCrossThoughtLinks(sentences);
  return sentences;
}
