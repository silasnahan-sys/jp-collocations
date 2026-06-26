// _tmp_pipeline/discourse.mjs
// =====================================================================
// 転換C: 階層反転 — flat な 1 文配列 + 後付け edge を、型付きの discourse
//   tree (EPISODE > SECTION > SEQUENCE > UTTERANCE > OPERATION) へ組み直す。
// ---------------------------------------------------------------------
// 診断 (監査 §0 / §6 / §10):
//   現状は per-sentence sticker board。section / sequence / adjacency-pair
//   は 0%。crossRefs (語彙エコー) だけが文間を繋いでいるが、これは談話の
//   背骨ではなく相関に過ぎない。談話文法が要求するのは:
//     最外層 = 編成 (section)
//       └ sequence (隣接ペア / PROBE→INFORM→NEWS-RECEIPT→RATIFY 連鎖)
//           └ utterance (発話 = 相互行為 act を担う)
//               └ operation (文内の操作 = 既存 sticker)
//   本モジュールは 転換B の interaction 軸 (act/move/pairPart) を材料に、
//   この木を構築する。crossRefs は **fallback link** に降格する。
// =====================================================================

// FPP (隣接ペア第1部分) を開く act
const FPP_ACTS = new Set(['PROBE', 'CONFIRM-SEEK', 'CONFIRM-APPEAL', 'ADDRESS-SUMMON']);
// SPP (第2部分) になり得る act
const SPP_ACTS = new Set(['INFORM', 'NEWS-RECEIPT', 'ALIGN', 'RATIFY', 'ASSERT', 'GROUND-CLAIM']);
// 純粋な受領・整列 (単独で sequence を構成せず、近接 sequence に吸着する)
const SUPPORT_ACTS = new Set(['ALIGN', 'NEWS-RECEIPT', 'RATIFY']);

// ─────────────────────────────────────────────────────────────────────
// 転換C 精緻化: SECTION 内のサブ move 署名 (監査 §6 / §10)。
//   utterance 単位で「謎かけの投げ込み」「オチ」「年号イベント」等の機能を付与。
// ─────────────────────────────────────────────────────────────────────
const SUBMOVE_SIGNATURES = [
  { role: 'PROJECTION', re: /こんな.{0,8}(?:話|昔話|男|女|人|やつ)が(?:あり|ある)/ },
  { role: 'PUNCHLINE',  re: /^(?:おしまい|おわり|お終い|めでたしめでたし|完)[。．！\s]*$/ },
  { role: 'DATE-EVENT', re: /\d{3,4}年/ },
  { role: 'TOPIC-NAME', re: /(?:って|っていう|という)(?:言葉|の|もの)が(?:あり|ある)/ },
];

// 対比ペア (CONTRAST-PAIR) を示す語彙手掛かり
const CONTRAST_CUE_RE = /(?:真逆|逆に|一方|対して|に対し|それに比べ|反対に|とは違|だが|ところが)/;
// 「Nは」主題を取り出す (対比の左右を同定するため)
const TOPIC_NP_RE = /([\u4E00-\u9FFFァ-ヶー]{2,12})(?:は|って|の方は)/;

/** utterance 1 件のサブ move を署名から判定 (無ければ null)。 */
function detectSubmove(text) {
  for (const sig of SUBMOVE_SIGNATURES) if (sig.re.test(text)) return sig.role;
  return null;
}

/**
 * turns を flat な utterance 列に展開する。
 * @returns {Array<{idx:number, speaker:string, text:string, act:string, move:string,
 *                  pairPart:string|null, addressee:string|null, opIds:string[], turnIndex:number}>}
 */
function flattenUtterances(turns) {
  const out = [];
  turns.forEach((t, ti) => {
    for (const s of t.sentences) {
      const it = s.interaction || {};
      const opIds = (s.operations?.instances || []).map(x => x.opId);
      const chain = opIds.length ? opIds : (s.chain || []);
      const txt = (s.text || '').trim();
      out.push({
        idx: s.idx,
        speaker: t.speaker,
        text: txt,
        act: it.act || 'ASSERT',
        move: it.move || 'continue',
        pairPart: it.pairPart || null,
        addressee: it.addressee || null,
        submove: detectSubmove(txt),
        opIds: chain,
        turnIndex: ti,
      });
    }
  });
  return out.sort((a, b) => a.idx - b.idx);
}

let _seqId = 0;
function makeSeq(kind, fpp) {
  return { id: ++_seqId, kind, members: [], pair: { first: fpp ? fpp.idx : null, second: null } };
}

/**
 * 1 セクション内の utterance 列から sequence 群を構築する。
 *   - FPP (PROBE/CONFIRM-*) を見たら adjacency-pair sequence を開き、別話者の
 *     SPP (INFORM 等) を second に取り、後続の NEWS-RECEIPT / RATIFY も吸収。
 *   - FPP の無い INFORM/ASSERT 連続 (同一主話者) は TELLING sequence。
 *   - 浮いた ALIGN/NEWS-RECEIPT は直前 sequence に support として吸着。
 */
function buildSequences(utts) {
  const seqs = [];
  let i = 0;
  let current = null; // 進行中の TELLING

  const closeTelling = () => { if (current && current.members.length) { seqs.push(current); } current = null; };

  while (i < utts.length) {
    const u = utts[i];

    if (FPP_ACTS.has(u.act) && u.pairPart === 'first') {
      closeTelling();
      const seq = makeSeq(u.act === 'ADDRESS-SUMMON' ? 'SUMMON-RESPONSE' : 'ADJACENCY-PAIR', u);
      seq.members.push(u);
      // SPP を探す: 別話者の最初の非 support 応答 (近接 8 within)。
      let j = i + 1;
      const limit = Math.min(utts.length, i + 9);
      for (; j < limit; j++) {
        const v = utts[j];
        seq.members.push(v);
        if (v.speaker !== u.speaker && SPP_ACTS.has(v.act) && seq.pair.second === null) {
          seq.pair.second = v.idx;
          // PROBE への INFORM 応答は ANSWER (sub-move) として標識。
          if (u.act === 'PROBE' && v.act === 'INFORM' && !v.submove) v.submove = 'ANSWER';
          // 後続の NEWS-RECEIPT / RATIFY を 1〜2 個吸収して閉じる。
          let k = j + 1;
          while (k < utts.length && k <= j + 2 && SUPPORT_ACTS.has(utts[k].act)) {
            seq.members.push(utts[k]); k++;
          }
          j = k - 1;
          break;
        }
        // FPP の連鎖 (insertion sequence) は break せず取り込み続ける。
        if (v.speaker !== u.speaker && !SUPPORT_ACTS.has(v.act) && v.act !== 'ASSERT') {
          // 応答性のある別話者発話。second 未確定なら確定。
          if (seq.pair.second === null && SPP_ACTS.has(v.act)) seq.pair.second = v.idx;
        }
      }
      seqs.push(seq);
      i = Math.max(i + 1, j + 1);
      continue;
    }

    if (SUPPORT_ACTS.has(u.act)) {
      // 浮いた受領: 直前 sequence に吸着、無ければ RECEIPT sequence。
      if (seqs.length) {
        seqs[seqs.length - 1].members.push(u);
      } else {
        closeTelling();
        const seq = makeSeq('RECEIPT', null);
        seq.members.push(u);
        seqs.push(seq);
      }
      i++;
      continue;
    }

    // INFORM / ASSERT / GROUND-CLAIM の連続 = TELLING (語りの連なり)。
    if (!current) current = makeSeq('TELLING', null);
    current.members.push(u);
    i++;
  }
  closeTelling();
  return seqs;
}

/**
 * TELLING に挟まれた完結隣接ペアを INSERTION (挿入連鎖) に標識する。
 */
function markInsertions(sequences) {
  for (let i = 1; i < sequences.length - 1; i++) {
    const prev = sequences[i - 1], cur = sequences[i], next = sequences[i + 1];
    if (cur.kind !== 'ADJACENCY-PAIR') continue;
    if (cur.pair.first === null || cur.pair.second === null) continue;
    if (prev.kind === 'TELLING' && next.kind === 'TELLING') cur.kind = 'INSERTION';
  }
}

/**
 * セクション内の対比ペア (X は… / Y は… + 対比手掛かり) を検出する。
 * 監査 §6: 「同 N 同 N 並列」「ATTRIBUTE-A バッハは… / ATTRIBUTE-B ヘンデルは…」。
 * @returns {Array<{leftIdx:number, rightIdx:number, left:string, right:string, cue:string}>}
 */
function detectContrastPairs(utts) {
  const pairs = [];
  let lastTopic = null; // {np, idx}
  for (const u of utts) {
    const tm = TOPIC_NP_RE.exec(u.text);
    const cue = CONTRAST_CUE_RE.exec(u.text);
    if (cue && lastTopic && tm && tm[1] !== lastTopic.np) {
      pairs.push({ leftIdx: lastTopic.idx, rightIdx: u.idx, left: lastTopic.np, right: tm[1], cue: cue[0] });
      lastTopic = { np: tm[1], idx: u.idx };
      continue;
    }
    if (tm) lastTopic = { np: tm[1], idx: u.idx };
  }
  return pairs;
}

/**
 * discourse tree を構築する。
 * @param {Array} turns                analyze の turns (interaction 付き)
 * @param {Array} macroSections        detectMacroSections の結果
 * @returns {{type:'EPISODE', sections:Array}}
 */
export function buildDiscourse(turns, macroSections) {
  _seqId = 0;
  const utts = flattenUtterances(turns);
  // idx → utterance 索引。
  const byIdx = new Map(utts.map(u => [u.idx, u]));

  const sections = (macroSections && macroSections.length)
    ? macroSections
    : [{ kind: 'BODY', fromTurn: 0, toTurn: turns.length - 1,
         idxFrom: utts[0]?.idx ?? -1, idxTo: utts[utts.length - 1]?.idx ?? -1 }];

  const tree = { type: 'EPISODE', sections: [] };
  for (const sec of sections) {
    const inSec = utts.filter(u => u.idx >= sec.idxFrom && u.idx <= sec.idxTo);
    const sequences = buildSequences(inSec);
    // 転換C 精緻化: TELLING に挟まれた隣接ペアを INSERTION (挿入連鎖) に標識。
    markInsertions(sequences);
    // 転換C 精緻化: セクション内の対比ペア (X は… / Y は…) を検出。
    const contrasts = detectContrastPairs(inSec);
    tree.sections.push({
      type: 'SECTION',
      kind: sec.kind,
      addressee: sec.addressee || null,
      fromTurn: sec.fromTurn,
      toTurn: sec.toTurn,
      idxFrom: sec.idxFrom,
      idxTo: sec.idxTo,
      utteranceCount: inSec.length,
      contrastPairs: contrasts,
      sequences: sequences.map(seq => ({
        type: 'SEQUENCE',
        id: seq.id,
        kind: seq.kind,
        pair: seq.pair,
        utterances: seq.members.map(u => ({
          type: 'UTTERANCE',
          idx: u.idx,
          speaker: u.speaker,
          act: u.act,
          move: u.move,
          pairPart: u.pairPart,
          submove: u.submove || null,
          text: u.text,
          operations: u.opIds,
        })),
      })),
    });
  }
  tree.stats = discourseProfile(tree);
  return tree;
}

/** tree の集計 (section 種別数 / sequence 種別数 / 完結ペア数 / submove / contrast)。 */
export function discourseProfile(tree) {
  const sectionKinds = {};
  const sequenceKinds = {};
  const submoveCounts = {};
  let sequences = 0, completedPairs = 0, utterances = 0, contrastPairs = 0;
  for (const sec of tree.sections) {
    sectionKinds[sec.kind] = (sectionKinds[sec.kind] || 0) + 1;
    contrastPairs += (sec.contrastPairs || []).length;
    for (const seq of sec.sequences) {
      sequences++;
      sequenceKinds[seq.kind] = (sequenceKinds[seq.kind] || 0) + 1;
      if (seq.pair && seq.pair.first !== null && seq.pair.second !== null) completedPairs++;
      utterances += seq.utterances.length;
      for (const u of seq.utterances) if (u.submove) submoveCounts[u.submove] = (submoveCounts[u.submove] || 0) + 1;
    }
  }
  return {
    sections: tree.sections.length,
    sectionKinds,
    sequences,
    sequenceKinds,
    completedPairs,
    contrastPairs,
    submoveCounts,
    utterances,
  };
}

const SECTION_JA = {
  'OPENING-ADDRESS': '開幕の呼びかけ',
  'BODY':            '本体',
  'RIDDLE':          '謎かけ',
  'TOPIC-LAUNCH':    '主題提示',
  'BIOGRAPHY':       '伝記の語り',
  'PROBLEM':         '問題の提起',
  'RESOLUTION':      '解決',
  'META-LESSON':     '教訓のまとめ',
  'CLOSING':         '結びの予告',
  'SIGN-OFF':        '締め',
};
const SEQ_JA = {
  'ADJACENCY-PAIR':  '隣接ペア',
  'SUMMON-RESPONSE': '呼応',
  'TELLING':         '語りの連なり',
  'RECEIPT':         '受領',
  'INSERTION':       '挿入連鎖',
};
const SUBMOVE_JA = {
  'PROJECTION': '謎かけの投げ込み',
  'PUNCHLINE':  'オチ',
  'DATE-EVENT': '年号イベント',
  'TOPIC-NAME': '主題語の提示',
  'ANSWER':     '答え',
};
export { SECTION_JA, SEQ_JA, SUBMOVE_JA };

/**
 * discourse tree を根から走査し、字下げした日本語アウトラインを返す。
 * narrate (flat) と異なり、編成 → 連鎖 → 発話の階層を提示する。
 * @param {{type:'EPISODE', sections:Array}} tree
 * @param {object} [opts] {maxUtterancesPerSeq:number}
 * @returns {string}
 */
export function narrateDiscourse(tree, opts = {}) {
  const maxU = opts.maxUtterancesPerSeq ?? 3;
  const lines = ['EPISODE'];
  for (const sec of tree.sections) {
    const ja = SECTION_JA[sec.kind] || sec.kind;
    const addr = sec.addressee ? `→${sec.addressee}` : '';
    lines.push(`├─ SECTION ${sec.kind}${addr} 〔${ja}〕 [T${sec.fromTurn}..T${sec.toTurn}] (${sec.utteranceCount}発話)`);
    for (const cp of (sec.contrastPairs || [])) {
      lines.push(`│  ◇ CONTRAST-PAIR 〔対比〕 #${cp.leftIdx}「${cp.left}」↔ #${cp.rightIdx}「${cp.right}」 (${cp.cue})`);
    }
    for (const seq of sec.sequences) {
      const sja = SEQ_JA[seq.kind] || seq.kind;
      const pair = (seq.pair && seq.pair.first !== null && seq.pair.second !== null)
        ? ` #${seq.pair.first}→#${seq.pair.second}` : '';
      lines.push(`│  ├─ SEQUENCE ${seq.kind} 〔${sja}〕${pair}`);
      const shown = seq.utterances.slice(0, maxU);
      for (const u of shown) {
        const snippet = u.text.length > 28 ? u.text.slice(0, 27) + '…' : u.text;
        const sm = u.submove ? ` 〈${SUBMOVE_JA[u.submove] || u.submove}〉` : '';
        lines.push(`│  │  └─ #${u.idx} ${u.speaker} [${u.act}/${u.move}]${sm} ${snippet}`);
      }
      if (seq.utterances.length > maxU) {
        lines.push(`│  │  └─ … 他 ${seq.utterances.length - maxU} 発話`);
      }
    }
  }
  return lines.join('\n');
}
