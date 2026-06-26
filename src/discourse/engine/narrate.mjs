// _tmp_pipeline/narrate.mjs
// L0-L6 で抽出した構造を、観測可能な根拠だけで 1〜3 文の日本語に要約する。
// 仕様: narrate.SPEC.md (P1.0)

const BANNED_WORDS = [
  '重要', '興味深い', '面白い', '驚くべき', '印象的',
  '実は', 'まさに', 'いわば', 'いわゆる',
  '美しい', '巧みな', '見事な', '感動', '心を打つ', '胸を打つ',
];

const QUOTE_TYPE_JA = {
  'quote.attributed':        '他者声',
  'quote.evoked-assumption': '召喚枠',
  'quote.suspended':         '宙吊り',
  'quote.self-thought':      '内心',
};

const KIND_JA = {
  resolves: '回収',
  endorses: '追認',
  contests: '撤回',
  reopens:  '再開',
  echoes:   '反響',
  refers:      '照応',
  discharges:  '消化',
  infers:      '帰結',
  reformulates:'言換',
  contrasts:   '対比',
  exemplifies: '例示',
  adds:        '追加',
  concludes:   '結論',
};

const PIVOT_JA = {
  'EXPLAIN-NOMINAL':     'なんですけど',
  'CONCESSIVE-CONTRAST': '逆接',
  'GROUND-CLAIM':        'じゃないですか',
  'CAUSAL-DERIVE':       'から',
  'CAUSAL-DEPENDENT':    'ので',
  'QUOTATIVE-ATTRIB':    'という',
};

/**
 * @typedef {{
 *   voiceChange: {from:string,to:string}|null,
 *   quoteType:   string|null,
 *   pivot:       {opId:string,surface:string}|null,
 *   flowEffect:  {added:string[],closed:string[]}|null,
 *   crossRef:    {kind:string,to:string,score:number}|null,
 *   transition:  string|null,
 * }} Slots
 */

/** @returns {Slots} */
function extractSlots(sentence, flowBefore) {
  const after = sentence.flowSnapshot?.activeVoice;
  const before = flowBefore?.activeVoice;
  const voiceChange = (after && before && after !== before) ? { from: before, to: after } : null;

  const quote = (sentence.quotes || [])[0];
  const pivot = (sentence.pivots || [])[0];
  const fd = sentence.flowDelta;
  const flowEffect = fd ? {
    added:  (fd.added  || []).map(a => a.kind),
    closed: (fd.closed || []).map(c => c.kind),
  } : null;
  const cref = (sentence.crossRefs || [])[0];
  const trans = (sentence.transitions || [])[0]?.kind || null;

  return {
    voiceChange,
    quoteType: quote ? quote.type : null,
    pivot: pivot ? { opId: pivot.opId, surface: pivot.anchor.surface } : null,
    flowEffect: (flowEffect && (flowEffect.added.length || flowEffect.closed.length)) ? flowEffect : null,
    crossRef: cref ? { kind: cref.kind, to: cref.to, score: cref.score } : null,
    transition: trans,
  };
}

function isEmpty(slots) {
  return !slots.voiceChange && !slots.quoteType && !slots.pivot &&
         !slots.flowEffect && !slots.crossRef && !slots.transition;
}

/** スロット 1 件ぶんを 1 文に変換(skeleton S1/S2/S3) */
function renderSentence(slots) {
  const parts = [];

  // S3 跨参照(優先度高)
  if (slots.crossRef) {
    const kindJa = KIND_JA[slots.crossRef.kind] || slots.crossRef.kind;
    parts.push(`${slots.crossRef.to}を${kindJa}する`);
  }

  // S1 構造変化(transition / pivot / flow)
  if (slots.transition === 'evoke-then-cancel') {
    parts.push('召喚枠を立てて取り消す');
  } else if (slots.transition === 'evoke-then-reframe') {
    parts.push('召喚枠を立ててから別枠で組み直す');
  } else if (slots.pivot) {
    const piv = PIVOT_JA[slots.pivot.opId] || slots.pivot.opId;
    parts.push(`${slots.pivot.surface}(${piv})で切れ目を入れる`);
  }

  // S1 補:flow 効果
  if (slots.flowEffect) {
    const eff = [];
    for (const a of slots.flowEffect.added)  eff.push(`+${a}`);
    for (const c of slots.flowEffect.closed) eff.push(`-${c}`);
    if (eff.length) parts.push(eff.join(' '));
  }

  // S2 声の遷移
  if (slots.voiceChange) {
    parts.push(`声が${slots.voiceChange.from}→${slots.voiceChange.to}`);
  } else if (slots.quoteType) {
    const q = QUOTE_TYPE_JA[slots.quoteType] || slots.quoteType;
    parts.push(`${q}を導入`);
  }

  if (!parts.length) return '';
  // 観測順に「、」で連結し最後に「。」
  return parts.join('、') + '。';
}

/**
 * 文脈意味読み (reading) から命題内容を含む 1 文を組み立てる。
 * reading が空なら null を返してスロット要約のみに任せる。
 */
function renderFromReading(reading) {
  if (!reading) return null;
  const parts = [];

  if (reading.backchannel) {
    parts.push(`「${reading.backchannel}」で受け取りを返す`);
  }

  if (reading.topic && !reading.backchannel) {
    parts.push(`「${reading.topic}」を主題に置く`);
  }

  if (reading.evokedFrame?.cue) {
    const tgt = reading.evokedFrame.target ? `『${reading.evokedFrame.target}』` : '何らかの命題';
    parts.push(`${tgt}を「${reading.evokedFrame.cue}」で聞き手と共有済みの前提として召喚`);
  }

  if (reading.contrast && (reading.contrast.left || reading.contrast.right)) {
    const L = reading.contrast.left || '?';
    const R = reading.contrast.right || '?';
    parts.push(`『${L}』に対し『${R}』へ「${reading.contrast.pivotSurface}」で反転`);
  }

  if (reading.suspended) {
    if (reading.suspended.wisher) {
      parts.push(`『${reading.suspended.proposition}』を${reading.suspended.wisher}の願望として宙吊りに残す`);
    } else if (reading.suspended.proposition) {
      parts.push(`『${reading.suspended.proposition}』を発話主に帰さず宙吊り`);
    } else {
      parts.push('命題を宙吊りに残す');
    }
  } else if (reading.claim && !reading.contrast && !reading.evokedFrame) {
    if (reading.claim.modality === 'wish' && reading.claim.subject) {
      parts.push(`${reading.claim.subject}の願望として『${reading.claim.predicate}』を陳述`);
    } else if (reading.claim.modality === 'epistemic-think' && reading.claim.subject) {
      parts.push(`${reading.claim.subject}について『${reading.claim.predicate}』と判じる`);
    } else if (reading.claim.subject) {
      parts.push(`${reading.claim.subject}について『${reading.claim.predicate}』を述べる`);
    } else if (reading.claim.raw) {
      parts.push(`『${reading.claim.raw}』を述べる`);
    }
  }

  if (reading.interrogation) {
    parts.push('問いの形で差し戻す');
  }

  if (reading.semanticEchoes?.length) {
    const e = reading.semanticEchoes[0];
    parts.push(`先行文#${e.fromSent}の「${e.token}」を再活性化`);
  }

  // L7.6 envelope (sense lattice):合成スタンスを末尾に添える
  if (reading.envelope) {
    const env = reading.envelope;
    const segs = [];
    if (env.composition?.length)        segs.push(env.composition[0]);
    if (env.tailSurface)                segs.push(`末尾包み「${env.tailSurface}」`);
    if (env.politeness?.length)         segs.push(`丁寧度:${env.politeness.join('+')}`);
    if (env.epistemic?.length)          segs.push(`認識:${env.epistemic.slice(0, 3).join('+')}`);
    if (env.interpersonal?.length)      segs.push(`対人:${env.interpersonal.slice(0, 3).join('+')}`);
    if (env.discourse?.length)          segs.push(`談話:${env.discourse.slice(0, 3).join('+')}`);
    if (segs.length) parts.push(`包み[${segs.join('/')}]`);
  }

  // L4.5 postpose:この文が直前文への後置補完
  if (reading.postposedTo !== undefined && reading.postposedTo !== null) {
    parts.push(`文#${reading.postposedTo}への後置補完`);
  }
  if (reading.attachedFrom?.length) {
    parts.push(`後置補完を受ける(文#${reading.attachedFrom.join(',')})`);
  }

  if (!parts.length) return null;
  return parts.join('、') + '。';
}

/**
 * @param {object} sentence  analyze() の sentences[i]
 * @param {object} [opts]
 * @param {object} [opts.flowBefore]  前文時点の flowSnapshot
 * @returns {{text:string, slots:Slots, warnings:string[]}}
 */
export function narrate(sentence, opts = {}) {
  const slots = extractSlots(sentence, opts.flowBefore);
  const warnings = [];

  // L7.5: 文脈意味読みを最優先で出す
  const readingLine = renderFromReading(sentence?.reading);
  const slotLine    = isEmpty(slots) ? '' : renderSentence(slots);

  let text;
  if (readingLine && slotLine)      text = readingLine + ' ' + slotLine;
  else if (readingLine)             text = readingLine;
  else if (slotLine)                text = slotLine;
  else return { text: '', slots, warnings: ['no-observable-change'] };

  // 文字数 240 字に切る
  if (text.length > 240) text = text.slice(0, 237) + '…。';

  // 禁止語ガード:含まれていたらその語を取り除く(skeleton 側で混入しない設計だが念のため)
  for (const banned of BANNED_WORDS) {
    if (text.includes(banned)) {
      text = text.split(banned).join('');
      warnings.push(`stripped-banned:${banned}`);
    }
  }

  return { text, slots, warnings };
}

/**
 * 文書全体を順に narrate する(flowBefore を渡し回す)。
 * @param {Array<object>} sentences
 * @returns {Array<{idx:number, text:string, slots:Slots, warnings:string[]}>}
 */
export function narrateDocument(sentences) {
  const out = [];
  let prevSnapshot = null;
  for (const s of sentences) {
    const r = narrate(s, { flowBefore: prevSnapshot });
    out.push({ idx: s.idx, ...r });
    prevSnapshot = s.flowSnapshot;
  }
  return out;
}

export { BANNED_WORDS };
