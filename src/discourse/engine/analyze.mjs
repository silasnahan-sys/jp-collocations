// _tmp_pipeline/analyze.mjs
// Orchestrator: input string → fully analyzed document.
// Stages: detect → parse → normalize → sentencize → turnize → skeleton →
// match → relations → assemble.

import { detectFormat } from './detect.mjs';
import { parseVtt, parseSrt } from './parse_vtt.mjs';
import { normalize } from './normalize.mjs';
import { sentencizeCues, sentencizePlain, sentencizeTagged } from './sentencize.mjs';
import { turnizeAuto } from './turnize.mjs';
import { skeletonOf } from './skeleton.mjs';
import { matchSentence, chainTree } from './match.mjs';
import { applySentenceRules, applyDocumentRules } from './relations.mjs';
import { structuralAnalysis } from './structure.mjs';
import { assignVoicing, classifyQuotes } from './voicing.mjs';
import { assignQuoteRelations } from './quote_relations.mjs';
import { decomposeQuoteFrames } from './quote_inner.mjs';
import { assignSourceTiers } from './source_hierarchy.mjs';
import { applyLenses } from './lenses.mjs';
import { analyzeOperations } from './operations.mjs';
import { reconcileVoicing, reconcileQuotes, deriveVoice } from './bridge.mjs';
import { assignThoughtLayer, thoughtLayerProfile } from './thought.mjs';
import { composeSentence } from './compose.mjs';
import { decomposeParts, makeFlowState, applyFlow, detectCrossRefs, computeDocumentIdf } from './flow.mjs';
import { detectSections, detectMacroSections } from './sections.mjs';
import { detectAll as detectTransitions } from './transitions.mjs';
import { assignInteraction, interactionProfile } from './interaction.mjs';
import { buildDiscourse } from './discourse.mjs';
import { narrateDocument } from './narrate.mjs';
import { interpretDocument } from './interpret.mjs';
import { OPERATOR_COUNT, TRIGGER_COUNT, OP_BY_ID } from './lexicon.mjs';

/** @param {string} raw */
export function analyze(raw) {
  const fmt = detectFormat(raw);
  let sentences;
  let cueStats = null;

  if (fmt.format === 'vtt') {
    const { cues, stats } = parseVtt(raw);
    cueStats = stats;
    sentences = sentencizeCues(cues);
  } else if (fmt.format === 'srt') {
    const { cues, stats } = parseSrt(raw);
    cueStats = stats;
    sentences = sentencizeCues(cues);
  } else if (fmt.format === 'tagged') {
    // 話者タグ付き (A:/B:/C: …) は話者を保持して文分割する。
    // sentencizePlain だと normalize がタグを潰し全体が 1 turn に融合していた。
    sentences = sentencizeTagged(raw);
  } else {
    const normed = normalize(raw).text;
    sentences = sentencizePlain(normed).map(t => ({ text: t }));
  }

  // Per-sentence analysis
  const analyzedSentences = sentences.map((s, i) => {
    const text = s.text;
    const skel = skeletonOf(text);
    const matchResult = matchSentence(text);
    let hits = applySentenceRules(text, matchResult.hits);
    // Structural relations: spans, bundles, pivots, moves.
    const structure = structuralAnalysis(text, hits);
    // Promote each bundle to an emergent hit so downstream rendering
    // and chain-views see it as a real discourse op.
    for (const b of structure.bundles) {
      const op = OP_BY_ID.get(b.name);
      if (!op) continue;
      hits.push({
        opId: b.name,
        opCategory: op.category,
        glossJa: op.gloss_ja,
        cognitiveEffect: op.cognitive_effect,
        surface: text.slice(b.start, b.end),
        offset: b.start,
        length: b.end - b.start,
        scope: 'bundle',
        position: 'medial',
        priority: (op.priority ?? 0) + 10,
        emergent: true,
        bundle: true,
        bundleMembers: b.opIds,
        bundleId: b.id,
        note: b.intent,
      });
    }
    // Promote each discourse-move to an emergent hit too.
    for (const m of structure.moves) {
      const op = OP_BY_ID.get(m.name);
      if (!op) continue;
      hits.push({
        opId: m.name,
        opCategory: op.category,
        glossJa: op.gloss_ja,
        cognitiveEffect: op.cognitive_effect,
        surface: text.slice(m.start, m.end),
        offset: m.start,
        length: m.end - m.start,
        scope: 'move',
        position: 'medial',
        priority: (op.priority ?? 0) + 10,
        emergent: true,
        move: true,
        moveId: m.id,
        moveMembers: m.members,
        note: m.intent,
      });
    }
    hits.sort((a, b) => a.offset - b.offset);

    // L3.9 abstract operations を先に計算 (転換A: operations を背骨の真実源に昇格)。
    // morpheme token 列 (role 付き / 境界整列 / 外挿可能) を voicing・quotes が
    // 参照できるよう、従来後段だった analyzeOperations をここへ前倒しする。
    const operations = analyzeOperations(text);

    // L2 voicing: 各 hit に「誰の声か」を付与
    hits = assignVoicing(text, hits);
    // 転換A-1: fallback (根拠なし) の声を operations 由来の構造的根拠で格上げ。
    //   evaluator.summon → S→X / voice.shift-cluster → S→H / tag.confirm → S+H。
    reconcileVoicing(text, hits, operations);
    // 転換A-3: 残る fallback を token stream から導出して確定させる。
    //   三人称信念→S→X / 一人称自己信念→S確定 / shift不在→derived S。
    deriveVoice(text, hits, operations);
    // L3 引用類型: と / という を四類型に分類
    const quotes = classifyQuotes(text, hits);
    // 転換A-2: report-verb 誤検出 (「って言葉」の「言」を発話動詞と誤認) を
    //   operations の token role で訂正し topic-quote に降格する。
    reconcileQuotes(text, quotes, operations);
    // L3.5 引用関係: 全 hit に source / addressee / rhetoricalUse / role を貫通
    //   (Phase 4A — 「引用は事例提示として機能する」 を op ごとに展開)
    const quoteRel = assignQuoteRelations(text, hits, quotes);
    // L3.6 各引用を独立ミニ文として再解析 (Phase 4B)
    decomposeQuoteFrames(quoteRel.frames);
    // L2.5 思考層: 内側 (musing/verdict/world-build/self-quote/reasoning) /
    //               外側 (address/backchannel/meta/frame-mark) を付与
    assignThoughtLayer(text, hits, structure.spans, quotes);
    const thoughtProfile = thoughtLayerProfile(hits);
    // L1.5 構成性: 各 hit を構成素列 + 合成効果に分解 (op id のラベル化を補正)
    composeSentence(text, hits);
    // L3.7 統一 source 階層 (Phase 4C) — voicing/quote/thought を 7 tier に統合
    const sourceProfile = assignSourceTiers(hits, quoteRel.frames);
    // L3.8 multi-lens annotation (Phase 5) — 同 span が複数レンズで同時に光る
    const lenses = applyLenses(text, hits, quoteRel.frames);
    // L3.9 operations は上で前倒し計算済 (転換A)。span は token 境界に厳密整列。
    // L4 speech-act パート分解
    const parts = decomposeParts(text, structure, hits, quotes);

    return {
      idx: i,
      text,
      speaker: s.speaker,
      startMs: s.startMs,
      endMs: s.endMs,
      skeleton: skel.skel,
      template: skel.template,
      segments: skel.segs,
      frame: skel.frame,
      hits,
      spans: structure.spans,
      bundles: structure.bundles,
      pivots: structure.pivots,
      moves: structure.moves,
      quotes,
      quoteFrames: quoteRel.frames,
      sourceProfile,
      lenses,
      operations,
      parts,
      thoughtProfile,
      backchannel: matchResult.backchannel,
    };
  });

  // Turn assembly
  let turns = turnizeAuto(analyzedSentences);
  turns = applyDocumentRules(turns);
  // 転換B: interactional 軸 (initiate/respond/follow-up/continue + 位置依存 act)を
  //   各 utterance に付与。voice 軸 (修辞的フィクション) とは独立。
  //   PROBE→INFORM→NEWS-RECEIPT→RATIFY シーケンスの足場になる。
  assignInteraction(turns);
  // flat 側へも idx 経由で同期 (interpret/narrate が analyzedSentences を歩くため)
  {
    const byIdx = new Map(analyzedSentences.map(s => [s.idx, s]));
    for (const t of turns) for (const ts of t.sentences) {
      const src = byIdx.get(ts.idx);
      if (src && ts.interaction) src.interaction = ts.interaction;
    }
  }
  const sections = detectSections(turns);  // 転換C: マクロセクション (文書全体を連続被覆) を検出し、interaction 軸を
  //   材料に discourse tree (EPISODE > SECTION > SEQUENCE > UTTERANCE) を組む。
  const macroSections = detectMacroSections(turns);
  const discourse = buildDiscourse(turns, macroSections);
  // L5 FLOW_STATE + L6 跨思考参照: 文書順に持ち回し(analyzedSentences を直接走査)
  const flow = makeFlowState();
  // P1.3: 文書スコープの IDF を一度だけ計算して flow に注入
  flow.idf = computeDocumentIdf(analyzedSentences);
  flow.docSize = analyzedSentences.length; // echo の idf 間引きは大文書のみ有効化
  for (const s of analyzedSentences) {
    const sa = {
      sentenceId: s.idx,
      text: s.text,
      parts: s.parts || [],
      quotes: s.quotes || [],
      hits: s.hits || [],
      operations: s.operations || null,
      structure: { spans: s.spans, bundles: s.bundles, pivots: s.pivots, moves: s.moves },
    };
    s.crossRefs = detectCrossRefs(flow, sa);
    s.flowSnapshot = {
      unclosedFrames:        flow.unclosedFrames.length,
      suspendedPropositions: flow.suspendedPropositions.length,
      evokedAssumptions:     flow.evokedAssumptions.length,
      activeVoice:           flow.activeVoice,
    };
    s.flowDelta = applyFlow(flow, sa);
    for (const p of s.parts || []) p.fullId = `s${s.idx}.${p.id}`;
  }

  // Build operator-chain summary per sentence
  for (const t of turns) {
    for (const s of t.sentences) {
      s.chain = (s.hits ?? []).map(h => h.opId);
      s.chainTree = chainTree(s.hits ?? []);
      s.cognitiveEffectChain = (s.hits ?? []).map(h => h.cognitiveEffect).filter(Boolean);
    }
  }

  // Document-level stats
  const opFreq = new Map();
  for (const t of turns) for (const s of t.sentences) for (const h of (s.hits ?? [])) {
    opFreq.set(h.opId, (opFreq.get(h.opId) ?? 0) + 1);
  }

  // P1.1: 隣接遷移 (evoke-then-cancel / evoke-then-reframe)
  const transitions = detectTransitions(analyzedSentences);
  // 文へ逆引きで貼る
  const transByIdx = new Map();
  for (const t of transitions) {
    if (!transByIdx.has(t.from)) transByIdx.set(t.from, []);
    transByIdx.get(t.from).push(t);
  }
  for (const s of analyzedSentences) s.transitions = transByIdx.get(s.idx) || [];

  // L7.5: 文脈意味読み (reading) を貼る — narrate より前
  interpretDocument(analyzedSentences);

  // interpretDocument は flat 側に envelope / postpose / attached / reading を貼る。
  // turnizeAuto が文を浅複製しているため、turn 側へ idx 経由で同期する。
  {
    const byIdx = new Map(analyzedSentences.map(s => [s.idx, s]));
    for (const t of turns) for (const ts of t.sentences) {
      const src = byIdx.get(ts.idx);
      if (!src) continue;
      ts.reading  = src.reading;
      ts.envelope = src.envelope;
      ts.postpose = src.postpose;
      ts.attached = src.attached;
      ts._fragmentClass = src._fragmentClass;
    }
  }

  // P1.4: ナラティブを 1 文ごとに生成(文学的装飾なし)
  const narratives = narrateDocument(analyzedSentences);
  for (const n of narratives) {
    const s = analyzedSentences[n.idx];
    if (s) s.narrative = { text: n.text, slots: n.slots, warnings: n.warnings };
  }
  const stats = {
    format: fmt,
    cueStats,
    sentenceCount: analyzedSentences.length,
    turnCount: turns.length,
    operatorOccurrences: [...opFreq.entries()].sort((a, b) => b[1] - a[1]),
    lexicon: { operators: OPERATOR_COUNT, triggers: TRIGGER_COUNT },
    sections,
    interaction: interactionProfile(turns),
    discourse: discourse.stats,
    confidence: rollupConfidence(analyzedSentences),
  };

  return { turns, sentences: analyzedSentences, stats, sections, macroSections, discourse, transitions, narratives };
}

/**
 * 文書全体の「分からない(未知)」量を集計する。
 * 各層が黙って既定値に落ちた割合を可視化し、空=正常 と 空=失敗 を区別可能にする。
 *   voice:   voiceConfidence==='fallback'        (根拠なく地の声 S)
 *   thought: thoughtLayerConfidence==='fallback' (根拠なく exterior.address)
 *   quote:   と/って 引用マーカー候補のうち type 未確定で落ちた数
 * しきい値超え時は warnings に文字列を積む(ダッシュボード/監査が拾える)。
 */
function rollupConfidence(sentences) {
  let hitsTotal = 0, voiceFallback = 0, thoughtFallback = 0;
  let voiceDerived = 0, voiceOperation = 0;
  let opContentTotal = 0, opContentEngaged = 0;
  let opInstances = 0;
  const opConf = { high: 0, medium: 0, low: 0 };
  for (const s of sentences) {
    for (const h of s.hits || []) {
      hitsTotal++;
      if (h.voiceConfidence === 'fallback') voiceFallback++;
      else if (h.voiceConfidence === 'derived') voiceDerived++;
      else if (h.voiceConfidence === 'operation') voiceOperation++;
      if (h.thoughtLayerConfidence === 'fallback') thoughtFallback++;
    }
    const ops = s.operations;
    if (ops && ops.coverage) {
      opContentTotal   += ops.coverage.contentTokens || 0;
      opContentEngaged += ops.coverage.engagedContent || 0;
      opInstances      += ops.totalInstances || 0;
      for (const k of ['high', 'medium', 'low'])
        opConf[k] += (ops.confidenceCounts?.[k] || 0);
    }
  }
  const ratio = (n, d) => (d ? n / d : 0);
  const warnings = [];
  const voiceRatio = ratio(voiceFallback, hitsTotal);
  const thoughtRatio = ratio(thoughtFallback, hitsTotal);
  // operation 層の未知 = 内容語のうち operation に触れられなかった割合
  const opUnknownRatio = 1 - ratio(opContentEngaged, opContentTotal);
  if (thoughtRatio >= 0.6)
    warnings.push(`thoughtLayer の ${Math.round(thoughtRatio * 100)}% が未知 (exterior.address 既定落ち)`);
  if (voiceRatio >= 0.8)
    warnings.push(`voice の ${Math.round(voiceRatio * 100)}% が未知 (地の声 S 既定落ち)`);
  // 内容語が十分あるのに operation が殆ど当たっていない = 構造未把握のシグナル
  if (opContentTotal >= 8 && opUnknownRatio >= 0.7)
    warnings.push(`operation 層が内容語の ${Math.round(opUnknownRatio * 100)}% を未把握 (語は見えるが操作未検出)`);
  return {
    hitsTotal,
    voiceFallback,
    voiceFallbackRatio: Number(voiceRatio.toFixed(3)),
    voiceDerived,
    voiceOperation,
    voiceDerivedRatio: Number(ratio(voiceDerived, hitsTotal).toFixed(3)),
    voiceNonSRatio: Number(ratio(voiceOperation, hitsTotal).toFixed(3)),
    thoughtFallback,
    thoughtFallbackRatio: Number(thoughtRatio.toFixed(3)),
    operations: {
      instances: opInstances,
      contentTokens: opContentTotal,
      engagedContent: opContentEngaged,
      coverageRatio: Number(ratio(opContentEngaged, opContentTotal).toFixed(3)),
      unknownRatio: Number(opUnknownRatio.toFixed(3)),
      confidenceCounts: opConf,
    },
    warnings,
  };
}

