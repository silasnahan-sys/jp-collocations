// _tmp_pipeline/relations.mjs
// =====================================================================
// CROSS-OPERATOR RELATION ENGINE
// ---------------------------------------------------------------------
// After per-sentence matching, apply rules that depend on multiple hits
// being present, absent, or in a particular order. This is where the
// LEXICON's "this trigger could mean A or B" gets resolved by context,
// and where emergent operators (SUSPEND-APODOSIS, MOTIVE-CONDITIONAL,
// GROUND-INSTALLED, FRAME-RESET) are emitted.
//
// Two layers:
//   (a) Sentence-internal rules — open/close spans within one sentence,
//       compose adjacent operators into composites, emit emergent ops.
//   (b) Document-level rules — turn-relative effects (a B turn that
//       opens with うん→BUILD-ON after an A turn that ended in
//       GROUND-CLAIM is GROUND-INSTALLED), anaphoric chains, repair
//       cancellations.
// =====================================================================

import { OP_BY_ID } from './lexicon.mjs';

/** Emit a synthetic operator hit (not from a trigger). */
function syntheticHit(opId, anchorHit, extra = {}) {
  const op = OP_BY_ID.get(opId);
  return {
    opId,
    opCategory: op?.category ?? 'emergent',
    glossJa: op?.gloss_ja ?? opId,
    cognitiveEffect: op?.cognitive_effect ?? '',
    surface: '',
    offset: anchorHit?.offset ?? 0,
    length: 0,
    scope: 'emergent',
    position: anchorHit?.position ?? 'final',
    priority: (op?.priority ?? 0) + 10,
    emergent: true,
    ...extra,
  };
}

/** ============= Sentence-internal rules ============= */

export function applySentenceRules(sentenceText, hits) {
  /** @type {any[]} */
  const out = [...hits];

  // Rule 1: SUSPEND-APODOSIS.
  // If a conditional-antecedent span was opened (CONDITIONAL-ANTECEDENT,
  // HYPOTHETICAL-SUPPOSING, WORLD-RECALL) and no operator with category
  // 'connective.causal' or any non-modal/non-meta hit follows after it AND
  // the sentence ends with 。 or comma, emit SUSPEND-APODOSIS.
  const condHits = out.filter(h =>
    h.opensSpan === 'conditional' || h.opensSpan === 'recalled-world' || h.opensSpan === 'conditional-concessive'
  );
  for (const cond of condHits) {
    const after = out.filter(h => h.offset > cond.offset);
    const hasConsequent = after.some(h =>
      h.opCategory.startsWith('connective.causal') ||
      h.opId === 'EXPLAIN-NOMINAL' ||
      h.opId === 'META-WRAP' ||
      h.opId === 'NORMATIVE' ||
      h.opId === 'DEONTIC-MUST' ||
      h.opId === 'EPISTEMIC-EXPECT' ||
      h.opId === 'EPISTEMIC-THINK' ||
      h.opId === 'GROUND-CLAIM' ||
      h.opId === 'CONFIRMATION-SEEK'
    );
    const endsWithPunct = /[。、,]$/.test(sentenceText.trim());
    if (!hasConsequent && endsWithPunct) {
      out.push(syntheticHit('SUSPEND-APODOSIS', cond, {
        anchorOpId: cond.opId,
        note: '条件節を開いたまま帰結なしで句点 → 聞き手に補完させる',
      }));
    }
  }

  // Rule 2: DANGLING-QUOTE.
  // If QUOTATIVE-ATTRIB opens a span and no QUOTATIVE-SPEECH closes it
  // within the sentence (no 言う/思う/感じる-class verb follows).
  // SUPPRESSED when META-SEGUE is present (というわけで closes the meta-frame).
  const hasMetaSegue = out.some(h => h.opId === 'META-SEGUE');
  const quoteOpens = out.filter(h => h.opensSpan === 'quotative');
  for (const q of quoteOpens) {
    if (hasMetaSegue) continue;
    const after = out.filter(h => h.offset > q.offset);
    const closed = after.some(h =>
      h.closesSpan === 'quotative' ||
      h.opId === 'QUOTATIVE-SPEECH' ||
      h.opId === 'NOMINALIZE-AS-CHOICE' ||
      h.opId === 'META-WRAP' ||
      h.opId === 'PASSIVE-HEARSAY' ||
      h.opId === 'REGRETFUL-PASSIVE' ||
      h.opId === 'META-DISCOURSE-REF'
    );
    if (!closed) {
      out.push(syntheticHit('DANGLING-QUOTE', q, {
        anchorOpId: q.opId,
        note: '引用枠を閉じずに放置 → 帰属を曖昧化',
      }));
    }
  }

  // Rule 3: Composition.
  // If two operators in `composes_with` adjacency, emit a synthetic composite
  // record (does NOT remove the parts — composite acts as an annotation).
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    if (!a.composesWith) continue;
    for (let j = i + 1; j < out.length; j++) {
      const b = out[j];
      const composite = a.composesWith[b.opId];
      if (composite && Math.abs(a.offset - b.offset) < 30) {
        out.push(syntheticHit(composite, a, {
          anchorOpId: a.opId,
          partnerOpId: b.opId,
          composite: true,
          note: `${a.opId} ⊕ ${b.opId} → ${composite}`,
        }));
      }
    }
  }

  // Rule 3b: HORTATIVE-PROPOSAL (volitive + EPISTEMIC-THINK adjacency).
  // 〜よう／ていこう followed by と思う within ~10 chars → speaker is
  // proposing rather than reporting belief.
  const volIds = new Set(['HORTATIVE-PROPOSAL']);
  const thinkHits = out.filter(h => h.opId === 'EPISTEMIC-THINK');
  for (const v of out) {
    if (!volIds.has(v.opId)) continue;
    for (const t of thinkHits) {
      if (Math.abs(v.offset - t.offset) <= 12) {
        out.push(syntheticHit('HORTATIVE-PROPOSAL', v, {
          anchorOpId: v.opId,
          partnerOpId: t.opId,
          composite: true,
          note: 'volitive ⊕ 思う → 提案フレーム',
        }));
        break;
      }
    }
  }

  // Rule 3c: REGRETFUL-PASSIVE — discourse-layer inference.
  // PASSIVE + COMPLETIVE morphology is just GRAMMAR; it does not entail
  // adversative discourse force. Emit the discourse op only when there is
  // contextual evidence of speaker-affect / 1st-person undergoer /
  // adversative content. Otherwise the grammar primitives stand on their
  // own (the reader sees PASSIVE-NEUTRAL + ASPECT-COMPLETIVE in the
  // chain, no REGRETFUL).
  const REG_FIRST_PERSON = /(?:私|僕|俺|あたし|わたし|うちが|うちは|うちも|うちに|こっち)/;
  const REG_AFFECT_LEX   = /(?:困|嫌|つら|まい|参っ|ひど|最悪|やばい|めんどく|うざ|まずい|やっちゃ)/;
  const REG_AFFECT_FINAL = /(?:もう[。、！\s]*$|よ[。、！\s]*$|わ[。、！\s]*$|な[。、！\s]*$)/;
  const REG_NEG_EVAL     = /(?:失敗|問題|被害|残念|悲し|怒|文句|不満)/;
  const passiveHits = out.filter(h =>
    h.opId === 'PASSIVE-HEARSAY' || h.opId === 'PASSIVE-NEUTRAL'
  );
  const completiveHits = out.filter(h => h.opId === 'ASPECT-COMPLETIVE');
  for (const p of passiveHits) {
    for (const c of completiveHits) {
      if (c.offset > p.offset && c.offset - (p.offset + p.length) < 8) {
        // Inspect contextual evidence in the sentence text.
        const before = sentenceText.slice(0, p.offset);
        const whole  = sentenceText;
        const tail   = sentenceText.slice(c.offset + c.length);
        const evidence = [];
        if (REG_FIRST_PERSON.test(before))         evidence.push('1st-person undergoer');
        if (REG_AFFECT_LEX.test(whole))            evidence.push('adversative lexeme');
        if (REG_AFFECT_FINAL.test(tail))           evidence.push('affect-final particle');
        if (REG_NEG_EVAL.test(whole))              evidence.push('negative evaluation');
        const already = out.some(h => h.opId === 'REGRETFUL-PASSIVE' && Math.abs(h.offset - p.offset) < 10);
        if (evidence.length >= 1 && !already) {
          out.push(syntheticHit('REGRETFUL-PASSIVE', p, {
            anchorOpId: p.opId,
            partnerOpId: c.opId,
            composite: true,
            derivedFrom: [p.opId, c.opId],
            contextEvidence: evidence,
            note: `受身 ⊕ しまった ⊕ [${evidence.join(', ')}] → 被害受身`,
          }));
        }
      }
    }
  }

  // Rule 3d: DECISION-INSTANTIATION.
  // DECISION-NOMINALIZE at sentence-final emits a forward-looking commitment
  // marker (consumed by document rules to thread future-action chains).
  for (const h of out) {
    if (h.opId === 'DECISION-NOMINALIZE' && h.position === 'final') {
      out.push(syntheticHit('DECISION-INSTANTIATION', h, {
        anchorOpId: h.opId,
        emergent: true,
        note: '話者が将来行為を確定 → 後続発話への参照点となる',
      }));
    }
  }


  // 3+ hedge operators in one sentence → emit composite (annotation only).
  const hedgeIds = new Set(['EPISTEMIC-MAY','EPISTEMIC-THINK','EVIDENTIAL-SEEM','HEDGE-INCOMPLETE','EXPLAIN-HEDGE','APPROXIMATIVE']);
  const hedgeCount = out.filter(h => hedgeIds.has(h.opId)).length;
  if (hedgeCount >= 3) {
    out.push(syntheticHit('EPISTEMIC-DISTANCE-AMPLIFY', out[0], {
      note: `${hedgeCount} hedge operators stacked → 距離増幅`,
      composite: true,
    }));
  }

  return out.sort((a, b) => a.offset - b.offset);
}

/** ============= Document-level rules ============= */

/**
 * @param {Array<{speaker:string, sentences: Array<{text:string, hits:any[]}>}>} turns
 * @returns {typeof turns}
 */
export function applyDocumentRules(turns) {
  // Rule D1: GROUND-INSTALLED.
  // If turn N ends in a GROUND-CLAIM and turn N+1 (different speaker) starts
  // with a backchannel/BUILD-ON, mark the GROUND-CLAIM as installed.
  for (let i = 0; i < turns.length - 1; i++) {
    const cur = turns[i];
    const nxt = turns[i + 1];
    if (cur.speaker === nxt.speaker) continue;
    const lastSent = cur.sentences[cur.sentences.length - 1];
    if (!lastSent) continue;
    const hadGround = lastSent.hits?.some(h => h.opId === 'GROUND-CLAIM' || h.opId === 'CONFIRMATION-SEEK');
    if (!hadGround) continue;
    const firstSent = nxt.sentences[0];
    if (!firstSent) continue;
    const accepted = firstSent.backchannel || firstSent.hits?.some(h => h.opId === 'BUILD-ON' || h.opId === 'AGREE-MARK');
    if (accepted) {
      lastSent.hits = [...(lastSent.hits ?? []), {
        opId: 'GROUND-INSTALLED',
        opCategory: 'emergent.discourse',
        glossJa: '基盤承認',
        cognitiveEffect: '主張が次ターンで承認 → 共通基盤に定着',
        surface: '',
        offset: lastSent.text.length,
        length: 0,
        position: 'final',
        priority: 99,
        emergent: true,
      }];
    } else {
      // Contested if next turn starts with a REJECT-CORRECTION or no uptake.
      const rejected = firstSent.hits?.some(h => h.opId === 'REJECT-CORRECTION');
      if (rejected) {
        lastSent.hits = [...(lastSent.hits ?? []), {
          opId: 'GROUND-CONTESTED',
          opCategory: 'emergent.discourse',
          glossJa: '基盤拒否',
          cognitiveEffect: '主張が次ターンで否認 → 共通基盤化に失敗',
          surface: '', offset: lastSent.text.length, length: 0,
          position: 'final', priority: 99, emergent: true,
        }];
      }
    }
  }

  // Rule D2: REPAIR-CANCEL.
  // A REFORMULATE-REPAIR or REJECT-CORRECTION in turn N+1 cancels the
  // dominant operator of the last sentence of turn N (annotation: cancelled).
  for (let i = 0; i < turns.length - 1; i++) {
    const cur = turns[i];
    const nxt = turns[i + 1];
    const firstSent = nxt.sentences[0];
    if (!firstSent) continue;
    const repair = firstSent.hits?.find(h => h.opId === 'REFORMULATE-REPAIR' || h.opId === 'REJECT-CORRECTION');
    if (!repair) continue;
    const lastSent = cur.sentences[cur.sentences.length - 1];
    if (!lastSent || !lastSent.hits?.length) continue;
    const target = lastSent.hits[lastSent.hits.length - 1];
    target.cancelledBy = { turn: i + 1, opId: repair.opId };
    target.cancelled = true;
  }

  // Rule D4: Q→A adjacency-pair edges.
  // A question-final sentence (？/ですか?/ますか?/んですか?/の?/かな?) opens
  // a pair. The next non-backchannel sentence in a DIFFERENT speaker within
  // a 10-sentence window is the answer.
  const flatQ = turns.flatMap((t, ti) => t.sentences.map((s, si) => ({ s, ti, si, speaker: t.speaker })));
  const Q_RE = /(?:[？?]|ですか[。．！？\s]*$|ますか[。．！？\s]*$|んですか[。．！？\s]*$|の[?？][。．\s]*$|かな[？?]?[。．\s]*$)/;
  let pairId = 0;
  for (let i = 0; i < flatQ.length; i++) {
    const { s, speaker } = flatQ[i];
    if (s.qa) continue; // already assigned (as answer)
    if (s.backchannel) continue;
    if (!Q_RE.test(s.text)) continue;
    pairId++;
    s.qa = { role: 'Q', pairId, partner: null };
    for (let j = i + 1; j < Math.min(flatQ.length, i + 11); j++) {
      const cand = flatQ[j];
      if (cand.speaker === speaker) continue;
      if (cand.s.backchannel) continue;
      const stripped = cand.s.text.replace(/[、。．,.\s「」『』！!？?ー~〜]/g, '');
      if (stripped.length < 2) continue;
      cand.s.qa = { role: 'A', pairId, partner: s.idx };
      s.qa.partner = cand.s.idx;
      break;
    }
  }

  // Rule D3: anaphoric chain.
  // Each そ-class hit (ANAPHORIC-TYPECALL, CLASS-LIFT, WORLD-RECALL) points
  // back to the most recent non-そ noun-phrase reference in the previous N
  // sentences. Annotate with `anaphoricTo: {turn, sentenceIdx}`.
  const flat = turns.flatMap((t, ti) => t.sentences.map((s, si) => ({ ...s, _turn: ti, _idx: si })));
  for (let i = 0; i < flat.length; i++) {
    const s = flat[i];
    if (!s.hits) continue;
    for (const h of s.hits) {
      if (h.opId === 'ANAPHORIC-TYPECALL' || h.opId === 'CLASS-LIFT' || h.opId === 'WORLD-RECALL') {
        // look back up to 5 sentences
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          const prev = flat[j];
          // crude: any sentence containing a kanji noun cluster
          if (/[一-龥々]{2,}/.test(prev.text)) {
            h.anaphoricTo = { turn: prev._turn, sentenceIdx: prev._idx, distance: i - j };
            break;
          }
        }
      }
    }
  }

  return turns;
}
