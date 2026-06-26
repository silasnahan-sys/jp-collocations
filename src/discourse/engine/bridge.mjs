// _tmp_pipeline/bridge.mjs
// =====================================================================
// 転換A: operations を談話分析の single source of truth に昇格させる橋。
// ---------------------------------------------------------------------
// 背景 (診断):
//   背骨 (voicing / quotes / parts / interpret / narrate) は今も旧 hits
//   (surface-regex で貼った op-id 列) の上に積まれており、Phase 6 の
//   operations (morpheme token の role パターンで検出, span を token 境界に
//   厳密整列, 未見内容語へ外挿可能) は dashboard 専用の飾りになっていた。
//
// このモジュールは operations.instances を「構造的に検証された根拠」として
//   旧 hits の voice / quote 判定を 補強・訂正・格上げ する。
//
// 設計原則:
//   ・operations は token 境界整列なので span は信頼できる。
//   ・旧 hit が fallback (= 根拠なく既定値に落ちた未知) のものを最優先で
//     operations 由来の根拠で格上げする。非 fallback (lexicon/rule で確定済) は
//     原則尊重し、明白な誤分類 (report-verb 誤検出) のみ operations で訂正する。
//   ・voiceConfidence='operation' / quoteSource='operation' を立て、
//     「どの op instance がこの判定を駆動したか」を evidence に残す (検証可能性)。
// =====================================================================

// ─────────────────────────────────────────────────────────────────────
// voice-family operation → 声チャンネルへの写像
//   evaluator.summon    : 名指しした評者の視点を借りる仮想審判   → 'S→X'
//   voice.shift-cluster : 明示引用記号なしの想像話者声への滑り込み → 'S→H'
//   tag.confirm         : 聴き手 (実在/想像) への確認 tag         → 'S+H'
//   voice.subjective-marker / conclusive-eval : 地の声内の主観評価 → 'S' (格上げ不要)
// ─────────────────────────────────────────────────────────────────────
const VOICE_OF_OP = {
  'evaluator.summon':    'S→X',
  'voice.shift-cluster': 'S→H',
  'tag.confirm':         'S+H',
};

// ─────────────────────────────────────────────────────────────────────
// 転換A 深掘り: 声を「状態量」として token stream から導出するための語彙。
//   voicing.mjs と整合する一人称 / 三人称主語パターン。
// ─────────────────────────────────────────────────────────────────────
const FIRST_PERSON_RE   = /(?:僕|私|俺|自分|あたし|うち|わたし|ぼく|おれ)/;
const THIRD_PERSON_HEAD = /(?:お父さん|お母さん|父|母|先生|社長|友達|彼女|彼|[一-龥ァ-ヶー]{2,}さん|[A-Za-zＡ-Ｚａ-ｚ一-龥ァ-ヶー]+(?:氏|君|くん|ちゃん))/;

/** hit の占有区間 [offset, offset+length) が op span と重なるか */
function hitInSpan(hit, span) {
  const hs = hit.offset;
  const he = hit.offset + (hit.length || 0);
  return hs < span.end && he > span.start;
}

/**
 * 転換A-1: fallback voice の hit を operations 由来の声で格上げする。
 * 非 fallback (lexicon/rule) の hit は触らない (既存 voice テストを保護)。
 *
 * @param {string} text
 * @param {Array<any>} hits   assignVoicing 済み hits (voice / voiceConfidence を持つ)
 * @param {{instances:Array<any>}} ops  analyzeOperations(text) の結果
 * @returns {Array<any>} hits (in-place 更新済み)
 */
export function reconcileVoicing(text, hits, ops) {
  if (!ops || !ops.instances) return hits;
  // voice-family の instance を span 開始順に
  const voiceInsts = ops.instances
    .filter(i => VOICE_OF_OP[i.opId])
    .sort((a, b) => a.span.start - b.span.start);
  if (!voiceInsts.length) return hits;

  for (const h of hits) {
    if (h.voiceConfidence !== 'fallback') continue; // 根拠ある声は尊重
    // この hit を最もよく覆う voice instance を選ぶ
    const inst = voiceInsts.find(i => hitInSpan(h, i.span));
    if (!inst) continue;
    const v = VOICE_OF_OP[inst.opId];
    if (!v || v === h.voice) continue;
    h.voice = v;
    h.voiceConfidence = 'operation';
    h.voiceEvidence = [...(h.voiceEvidence || []), `op:${inst.opId}@${inst.span.start}-${inst.span.end}`];
  }
  return hits;
}

/**
 * 転換A-2: 旧 classifyQuotes の report-verb 誤検出を operations で訂正する。
 *
 * 旧 classifyQuotes は「って/と」の直後が REPORT_HEAD 正規表現にマッチすると
 * quote.attributed と判定する。しかし「ヘンデルって言葉が」の「言葉」のように
 * 直後が *名詞* の場合、「言」を発話動詞と誤認して引用化してしまう
 * (監査 §4.2 #11 の TOPIC-QUOTE 問題)。
 *
 * operations の token stream では「言葉」は content token であり、QUOTATIVE-MARKER
 * の直後に SAY/BELIEF role の morph token が無い。これを根拠に、誤って
 * attributed にされた quote を 非引用 (topic-quote) に降格する。
 *
 * @param {string} text
 * @param {Array<any>} quotes  classifyQuotes の結果
 * @param {{tokens:Array<any>}} ops
 * @returns {Array<any>} 訂正後の quotes (誤検出は type を 'quote.topic' に変更)
 */
export function reconcileQuotes(text, quotes, ops) {
  if (!ops || !ops.tokens) return quotes;
  const tokens = ops.tokens;
  for (const q of quotes) {
    if (q.type !== 'quote.attributed') continue;
    // この quote マーカーに対応する QUOTATIVE-MARKER token を探す
    const markEnd = q.offset + q.length;
    // quote 直後の最初の非 punct token を取る
    const next = tokens.find(t => t.start >= markEnd && t.kind !== 'punct');
    if (!next) continue;
    // 直後が content (名詞語幹) で、かつ SAY/BELIEF role の morph でないなら
    // report-verb 誤検出 → topic-quote に降格
    const isReportMorph = next.kind === 'morph' &&
      /^(SAY-VERB|SAY-VERB-PASSIVE|BELIEF-VERB|BELIEF-VERB-CITE-SELF|COGNITION-VERB)$/.test(next.role || '');
    if (next.kind === 'content' && !isReportMorph) {
      // 「言葉」「話」等の名詞アンカーで報告動詞 evidence が付いた場合のみ訂正
      const wasReportEv = (q.evidence || []).some(e => /report-verb|closer/.test(e));
      if (wasReportEv) {
        q.type = 'quote.topic';
        q.quoteSource = 'operation';
        q.evidence = [...(q.evidence || []), `op-correct:next-content:${next.surface}`];
      }
    }
  }
  return quotes;
}

// ─────────────────────────────────────────────────────────────────────
// 転換A 深掘り: 声を token stream から導出する (fallback の悲観を解消)。
// ---------------------------------------------------------------------
// 診断:
//   voiceFallback 62.3% の正体は「独白モデルで対話を見ていた」副作用。
//   CONCESSIVE-CONTRAST / CONDITIONAL-ANTECEDENT / CAUSAL-DERIVE 等の
//   *構造・命題操作子* は、本来「その時アクティブな声の中で働く」もので、
//   実在の話者ターン (転換B が確立) では話者自身の地の声 S が *正しい*。
//   旧コードはこれを「根拠なく S に落ちた fallback」と悲観ラベルしていた。
//
//   deriveVoice は token stream を走査して voice-shift 手掛かりの作動区間を
//   構築し、各 fallback hit について:
//     ・非 S 区間に覆われる → そのチャンネルへ格上げ (confidence 'operation')
//     ・どの shift も作動していない → 'derived' S (話者の地の声を *確認* した
//       上での S。「諦め」ではなく「shift 不在の検証済」)
//   これにより fallback は「真に token stream が無い」場合のみに限定される。
// ─────────────────────────────────────────────────────────────────────

/**
 * token stream から voice-shift の作動区間を構築する。
 * @returns {Array<{start:number, end:number, voice:string, reason:string}>}
 */
function buildVoiceIntervals(text, ops) {
  const iv = [];
  const tokens = ops.tokens || [];
  // (1) BELIEF/COGNITION 動詞 → 左方の最近接主語で声を決める。
  //     三人称主語 → S→[人物] (人物の信念を演じる) / 一人称 → S 確定。
  for (const t of tokens) {
    if (t.kind !== 'morph') continue;
    if (!/^(?:BELIEF-VERB|COGNITION-VERB)$/.test(t.role || '')) continue;
    const left = text.slice(0, t.start);
    const fpAll = [...left.matchAll(new RegExp(FIRST_PERSON_RE.source, 'g'))];
    const tpAll = [...left.matchAll(new RegExp(THIRD_PERSON_HEAD.source, 'g'))];
    const fp = fpAll.length ? fpAll[fpAll.length - 1] : null;
    const tp = tpAll.length ? tpAll[tpAll.length - 1] : null;
    if (tp && (!fp || tp.index > fp.index)) {
      iv.push({ start: tp.index, end: t.end, voice: `S→${tp[0]}`, reason: `belief-subj:${tp[0]}` });
    } else if (fp) {
      iv.push({ start: fp.index, end: t.end, voice: 'S', reason: `self-belief:${fp[0]}` });
    }
  }
  // (2) voice-family op instances (evaluator.summon 等) も区間に畳み込む。
  for (const inst of (ops.instances || [])) {
    const v = VOICE_OF_OP[inst.opId];
    if (v) iv.push({ start: inst.span.start, end: inst.span.end, voice: v, reason: `op:${inst.opId}` });
  }
  return iv.sort((a, b) => a.start - b.start);
}

/**
 * 転換A-3: fallback voice を token stream から導出して確定させる。
 * 非 fallback (lexicon/rule/operation) の hit は触らない。
 *
 * @param {string} text
 * @param {Array<any>} hits  reconcileVoicing 後の hits
 * @param {{tokens:Array<any>, instances:Array<any>}} ops
 * @returns {Array<any>} hits (in-place 更新済み)
 */
export function deriveVoice(text, hits, ops) {
  if (!ops || !ops.tokens) return hits;
  const iv = buildVoiceIntervals(text, ops);
  for (const h of hits) {
    if (h.voiceConfidence !== 'fallback') continue;
    const cover = iv.find(x => h.offset < x.end && (h.offset + (h.length || 0)) > x.start);
    if (cover && cover.voice !== 'S') {
      h.voice = cover.voice;
      h.voiceConfidence = 'operation';
      h.voiceEvidence = [...(h.voiceEvidence || []), `derived:${cover.reason}@${cover.start}-${cover.end}`];
    } else {
      // 話者の地の声 S を確認 (shift 不在 / または一人称自己信念)。
      h.voice = 'S';
      h.voiceConfidence = 'derived';
      h.voiceEvidence = [...(h.voiceEvidence || []), cover ? `base-voice:${cover.reason}` : 'base-voice:no-shift-cue'];
    }
  }
  return hits;
}
