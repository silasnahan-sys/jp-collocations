// _tmp_pipeline/sections.mjs
// Lightweight bookend detector: identifies OPENING-ADDRESS and SIGN-OFF
// regions of a transcript. Mid-document sections (BIOGRAPHY, PROBLEM,
// RESOLUTION) require topic-shift detection and are deliberately out of
// scope for v1.

const VOC_RE = /^([\u4E00-\u9FFFぁ-んァ-ヴーA-Za-z]{1,8})(?:君|さん|先生|ちゃん)[、。．！]/;
const RECEIPT_RE = /^(?:はい|うん|ええ|そうです|よろしくお願いします|よろしく)[、。．！\s]/;
const SIGNOFF_PATS = [
  /本日.{0,8}(?:以上|終わり|終了)/,
  /ありがとうございました/,
  /また.{0,4}お会い/,
  /次回/,
  /それでは.{0,8}失礼/,
  /お疲れ.{0,3}でした/,
];

/** Detect bookend sections on the flat turn list.
 *  @param {Array<{speaker:string, sentences:any[]}>} turns
 *  @returns {Array<{kind:string, fromTurn:number, toTurn:number, addressee?:string}>}
 */
export function detectSections(turns) {
  const sections = [];
  if (!turns.length) return sections;

  // OPENING-ADDRESS: vocative within first 3 turns + receipt within next 2 turns.
  outer: for (let i = 0; i < Math.min(3, turns.length); i++) {
    for (const s of turns[i].sentences) {
      const m = VOC_RE.exec(s.text);
      if (!m) continue;
      const addressee = m[1];
      for (let j = i + 1; j <= Math.min(i + 2, turns.length - 1); j++) {
        const firstSent = turns[j].sentences[0];
        if (!firstSent) continue;
        if (turns[j].speaker !== turns[i].speaker && RECEIPT_RE.test(firstSent.text)) {
          sections.push({ kind: 'OPENING-ADDRESS', fromTurn: i, toTurn: j, addressee });
          break outer;
        }
      }
    }
  }

  // SIGN-OFF: any signoff pattern in last 5 turns.
  const start = Math.max(0, turns.length - 5);
  for (let i = start; i < turns.length; i++) {
    for (const s of turns[i].sentences) {
      for (const pat of SIGNOFF_PATS) {
        if (pat.test(s.text)) {
          const last = sections.find(x => x.kind === 'SIGN-OFF');
          if (last) { last.toTurn = turns.length - 1; }
          else sections.push({ kind: 'SIGN-OFF', fromTurn: i, toTurn: turns.length - 1 });
        }
      }
    }
  }

  return sections;
}

// =====================================================================
// 転換C: マクロ・セクション署名 (監査 §6)。
//   bookend (OPENING-ADDRESS / SIGN-OFF) だけでなく、文書中盤の編成境界も
//   安価な署名で検出し、文書全体を連続したセクション span で覆う。
//   これが discourse tree の最外層 (EPISODE > SECTION) になる。
// ---------------------------------------------------------------------
// 各署名は「最初に発火した turn」がそのセクションの開始点。発火点を文書順に
// 並べ、隣接する発火点までを 1 セクションとする (= 連続被覆)。過剰検出を避け
// るため各 kind は最初の 1 回のみ境界を立てる。
// =====================================================================

/** @type {Array<{kind:string, re:RegExp}>} 中盤セクションの開始署名 */
const MACRO_SIGNATURES = [
  // RIDDLE-PROJECTION: 「こんな N があります」+ 直後に過去形の語り
  { kind: 'RIDDLE',        re: /こんな.{0,8}(?:話|昔話|男|女|人|の|やつ)が(?:あり|ある)/ },
  // TOPIC-LAUNCH: 裸主題「N って言葉があります(ね)」/「N というのがあります」
  { kind: 'TOPIC-LAUNCH',  re: /(?:って|っていう|という)(?:言葉|の|もの)が(?:あり|ある)/ },
  // BIOGRAPHY-NARRATIVE: 年号 + 移動/誕生/就任など (date-anchored event)
  { kind: 'BIOGRAPHY',     re: /\d{3,4}年.{0,12}(?:戻っ|生まれ|誕生|移|渡|就任|没|死|来|行っ|招|赴)/ },
  // PROBLEM-BLOCK: PROJECTION-OF-TROUBLE
  { kind: 'PROBLEM',       re: /(?:揉め|大ピンチ|ピンチが訪|危機|破綻|衰退|バブル|借金|赤字|窮地|追い込ま)/ },
  // RESOLUTION-BLOCK: RESOLUTION-PROJECTION
  { kind: 'RESOLUTION',    re: /(?:一手を打つ|戦いを制|乗り越え|復活|起死回生|転換(?:し|を|点)|成功を収め|挽回)/ },
  // META-LESSON: 一般化 move (締めの教訓)。頻出の「だと思います」は除外し、
  //   明示的なまとめ句に限定する。
  { kind: 'META-LESSON',   re: /(?:ということで.{0,12}(?:以上|人生|まとめ|でした)|見習わ(?:なきゃ|ない|ね)|教訓|から学べ(?:る|ます))/ },
  // CLOSING-PROJECTION: 次回予告
  { kind: 'CLOSING',       re: /(?:次回|また次|続きは)/ },
];

/**
 * 文書全体を連続したマクロ・セクションへ分節する。
 * @param {Array<{speaker:string, sentences:any[]}>} turns
 * @returns {Array<{kind:string, fromTurn:number, toTurn:number, addressee?:string, idxFrom:number, idxTo:number}>}
 */
export function detectMacroSections(turns) {
  if (!turns.length) return [];
  const bookends = detectSections(turns);
  const opening  = bookends.find(s => s.kind === 'OPENING-ADDRESS');
  const signoff  = bookends.find(s => s.kind === 'SIGN-OFF');

  // 各 kind の最初の発火 turn を集める。
  const fired = new Map(); // kind -> fromTurn
  const seen = new Set();
  for (let ti = 0; ti < turns.length; ti++) {
    for (const s of turns[ti].sentences) {
      for (const sig of MACRO_SIGNATURES) {
        if (seen.has(sig.kind)) continue;
        if (sig.re.test(s.text)) { fired.set(sig.kind, ti); seen.add(sig.kind); }
      }
    }
  }

  // 境界点 (turnIndex, kind) を文書順に整列。
  const boundaries = [];
  // OPENING は常に turn0 起点。
  if (opening) boundaries.push({ kind: 'OPENING-ADDRESS', fromTurn: 0, addressee: opening.addressee });
  for (const [kind, ft] of fired) boundaries.push({ kind, fromTurn: ft });
  // SIGN-OFF は末尾の境界。
  if (signoff) boundaries.push({ kind: 'SIGN-OFF', fromTurn: signoff.fromTurn });

  boundaries.sort((a, b) => a.fromTurn - b.fromTurn);

  // 同一 turn に複数境界が来たら最初の 1 つだけ残す (順序優先)。
  const dedup = [];
  for (const b of boundaries) {
    if (dedup.length && dedup[dedup.length - 1].fromTurn === b.fromTurn) continue;
    dedup.push(b);
  }

  // 先頭が turn0 でなければ BODY セクションで覆う。
  if (!dedup.length || dedup[0].fromTurn > 0) {
    dedup.unshift({ kind: 'BODY', fromTurn: 0 });
  }

  // 連続 span に変換。
  const sections = [];
  for (let i = 0; i < dedup.length; i++) {
    const fromTurn = dedup[i].fromTurn;
    const toTurn = (i + 1 < dedup.length) ? dedup[i + 1].fromTurn - 1 : turns.length - 1;
    if (toTurn < fromTurn) continue;
    const idxFrom = turns[fromTurn].sentences[0]?.idx ?? -1;
    const lastSents = turns[toTurn].sentences;
    const idxTo = lastSents[lastSents.length - 1]?.idx ?? idxFrom;
    const sec = { kind: dedup[i].kind, fromTurn, toTurn, idxFrom, idxTo };
    if (dedup[i].addressee) sec.addressee = dedup[i].addressee;
    sections.push(sec);
  }
  return sections;
}
