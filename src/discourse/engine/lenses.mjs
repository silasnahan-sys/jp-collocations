// _tmp_pipeline/lenses.mjs
// Phase 5 → Phase 6: 「レンズ」は今や operations.mjs の op instance の
// re-projection (再投影) にすぎない。表面 regex は撤廃。
//
// 各レンズの仕事 = ある op instance 群を「この解釈角度から見た時の note/role/intensity」で
// 言い換えて返す。span 自体は op instance のものをそのまま使う (token 境界整列が保証される)。
//
// 公開 API は不変: { LENSES, applyLenses(text, hits, frames) }

import { analyzeOperations } from './operations.mjs';

// 各 lens: { lensId, lensLabel, lensColor, group, derive(ops, text) → spans[] }
// span shape: { start, end, surface, role, note, intensity? }

function spanOfInst(inst, text, role, note, intensity) {
  const s = {
    start: inst.span.start,
    end: inst.span.end,
    surface: text.slice(inst.span.start, inst.span.end),
    role, note,
  };
  if (intensity) s.intensity = intensity;
  return s;
}

// ─────────────────────────────────────────────────────────────────────────
const L_EXAMPLE_OPEN = {
  lensId: 'example-open', lensLabel: '例示開示', lensColor: '#fc6', group: 'frame',
  detect(ops, text) {
    return ops.instances
      .filter(i => i.opId === 'frame.open' && i.evidenceTokenIds
        .some(id => ops.tokens[id]?.role === 'EXEMPLIFY-MARK'))
      .map(i => spanOfInst(i, text,
        'example-trigger',
        '仮想シナリオの幕開け — ここから先は語り手が「想像上の場面」を提示する'));
  },
};

const L_SITUATION_SETTER = {
  lensId: 'situation-setter', lensLabel: '状況設定', lensColor: '#9cf', group: 'frame',
  detect(ops, text) {
    return ops.instances
      .filter(i => i.opId === 'argument.typing')
      .map(i => spanOfInst(i, text,
        'situation-frame',
        '仮想場面の前提を固定 (「もし〜だとして」の枠組み確立)'));
  },
};

const L_KIND_CYCLE = {
  lensId: 'kind-cycle', lensLabel: '種類の心内列挙', lensColor: '#bfc', group: 'enum',
  detect(ops, text) {
    const out = [];
    // 広 span: enum.cycle 全体
    for (const i of ops.instances) {
      if (i.opId === 'enum.cycle') {
        out.push(spanOfInst(i, text,
          'kind-enum-cycling',
          '想像話者が心内で候補を回している感 (大雑把化 + 列挙の意図のぼかし)',
          i.intensity));
      }
    }
    // 狭 span: 個々の EXEMPLIFIER-HEDGE token を 1 個ずつ
    // (心内 cycling の 1 拍 1 拍 を見せるため — 広 span と重めて点灯し、hotspot を作る)
    for (const tk of ops.tokens) {
      if (tk.kind === 'morph' && tk.role === 'EXEMPLIFIER-HEDGE') {
        out.push({
          start: tk.start, end: tk.end, surface: tk.surface,
          role: 'kind-enum-beat',
          note: '個々の「とか」拍 — 列挙の 1 ステップ',
        });
      }
    }
    return out;
  },
};

const L_VOICE_SLIDE = {
  lensId: 'voice-slide', lensLabel: '声の滑り込み', lensColor: '#f9b', group: 'voice',
  detect(ops, text) {
    const out = [];
    for (const i of ops.instances) {
      if (i.opId === 'voice.subjective-marker') {
        out.push(spanOfInst(i, text,
          'imagined-voice-emerges',
          '想像話者の主観副詞が立ち上がる — 以降の数フレーズは地の声でなく想像話者の口調'));
      } else if (i.opId === 'voice.conclusive-eval') {
        out.push(spanOfInst(i, text,
          'imagined-voice-conclusion',
          '「〜方がいい/べきだ」は地の声の論証でなく、想像話者が辿り着く結論口調'));
      }
    }
    return out;
  },
};

const L_NORM_ECHO = {
  lensId: 'norm-echo', lensLabel: '通念の反響', lensColor: '#fcd', group: 'voice',
  detect(ops, text) {
    const out = [];
    for (let k = 0; k < ops.tokens.length; k++) {
      const t = ops.tokens[k];
      if (t.kind === 'morph' && t.role === 'DEMONSTRATIVE-ADNOMINAL') {
        out.push({ start: t.start, end: t.end, surface: t.surface,
          role: 'norm-deixis',
          note: '想像話者の視点から「世の中こうやって言う」と指す指示詞' });
      }
    }
    for (const inst of ops.instances) {
      if (inst.opId === 'tag.confirm') {
        out.push(spanOfInst(inst, text,
          'norm-tag-confirmation',
          '想像話者が通念に「ね/よね/でしょ」で同意確認をかぶせる — 反響の閉じ目'));
      }
    }
    return out;
  },
};

const L_DOUBLE_EXPOSURE = {
  lensId: 'double-exposure', lensLabel: '人類≡状況の二重露光', lensColor: '#fa8', group: 'noun-phrase',
  detect(ops, text) {
    return ops.instances
      .filter(i => i.opId === 'np.multi-instance')
      .map(i => spanOfInst(i, text,
        'person-kind-and-situation',
        '同一 span が「人の種類」かつ「状況タイプ」かつ「想像話者の心内列挙対象」の三重露光',
        'high'));
  },
};

const L_TOPIC_CONTRAST = {
  lensId: 'topic-contrast', lensLabel: '話題化+暗黙対比', lensColor: '#c9f', group: 'topic',
  detect(ops, text) {
    return ops.instances
      .filter(i => i.opId === 'recall.categorize')
      .map(i => spanOfInst(i, text,
        'topic-with-implicit-contrast',
        '単なる topic 化ではなく「前述したアレを取り上げて = 別のものと対比する準備」'));
  },
};

const L_EXAMPLE_DEPTH = {
  lensId: 'example-depth', lensLabel: '例示入れ子深度', lensColor: '#cb8', group: 'frame',
  detect(ops, text) {
    return ops.instances
      .filter(i => i.opId === 'frame.open' && i.evidenceTokenIds
        .some(id => ops.tokens[id]?.role === 'EXEMPLIFY-MARK'))
      .map(i => spanOfInst(i, text,
        `example-depth-${i.depth ?? 1}`,
        `この文書中で ${i.depth ?? 1} 番目の「例えば」 — 入れ子の depth=${i.depth ?? 1}`));
  },
};

const L_EVALUATOR_SUMMON = {
  lensId: 'evaluator-summon', lensLabel: '評者召喚', lensColor: '#f9f', group: 'voice',
  detect(ops, text) {
    return ops.instances
      .filter(i => i.opId === 'evaluator.summon')
      .map(i => spanOfInst(i, text,
        'named-imagined-evaluator',
        '名指しされた想像評者を召喚し、自己の選択を仮想的に審判させる meta-layer',
        'high'));
  },
};

const L_WRAP_AND_RESTATE = {
  lensId: 'wrap-restate', lensLabel: '締め直しと別例化', lensColor: '#cde', group: 'closure',
  detect(ops, text) {
    return ops.instances
      .filter(i => i.opId === 'wrap.quote-nominal')
      .map(i => spanOfInst(i, text,
        'wrap-as-another-instance',
        '直前まで展開した内容を「もう一つの同種事例」として畳み込み直す閉じ動作'));
  },
};

const L_HEDGE_DISTANCE = {
  lensId: 'hedge-distance', lensLabel: '主張と距離化の同時', lensColor: '#9ab', group: 'modal',
  detect(ops, text) {
    return ops.instances
      .filter(i => i.opId === 'hedge')
      .map(i => spanOfInst(i, text,
        'hedge-feeling',
        '主張しつつ「自分の感じ方にすぎない」と保留 — 同時に押し出して引く'));
  },
};

const L_SELF_DIALOG = {
  lensId: 'self-dialog', lensLabel: '自己内対話', lensColor: '#fed', group: 'voice',
  detect(ops, text) {
    return ops.instances
      .filter(i => i.opId === 'self.objectify')
      .map(i => spanOfInst(i, text,
        'self-addresses-self',
        '自分が自分の○○を扱う対象として外在化 — 主体と客体を一人称内で分裂させる',
        'high'));
  },
};

const L_REASONING_STAGE = {
  lensId: 'reasoning-stage', lensLabel: '根拠提示の劇場化', lensColor: '#fc8', group: 'reasoning',
  detect(ops, text) {
    const out = [];
    for (const i of ops.instances) {
      if (i.opId === 'argument.typing') {
        out.push(spanOfInst(i, text,
          'reasoning-frame',
          '推論の足場を明示的に舞台化 — 「これを根拠に持ってきますよ」と宣言'));
      } else if (i.opId === 'reify.product') {
        out.push(spanOfInst(i, text,
          'reasoning-product-as-noun',
          '推論の結果を名詞化 (「選択」「判断」「理解」) — 行為を物として手渡す閉じ'));
      }
    }
    return out;
  },
};

const L_TIME_BEAT = {
  lensId: 'time-beat', lensLabel: '時相の刻み', lensColor: '#9cb', group: 'time',
  detect(ops, text) {
    const out = [];
    for (const i of ops.instances) {
      if (i.opId !== 'frame.open') continue;
      const isTemporal = i.evidenceTokenIds.some(id => {
        const t = ops.tokens[id];
        return t?.role === 'TEMPORAL-FRAME-NOUN';
      });
      if (isTemporal) {
        out.push(spanOfInst(i, text,
          'scenario-time-beat',
          '想像場面のタイムラインを刻む拍 — 「その瞬間」を区切る'));
      }
    }
    return out;
  },
};

export const LENSES = [
  L_EXAMPLE_OPEN,
  L_SITUATION_SETTER,
  L_KIND_CYCLE,
  L_VOICE_SLIDE,
  L_NORM_ECHO,
  L_DOUBLE_EXPOSURE,
  L_TOPIC_CONTRAST,
  L_EXAMPLE_DEPTH,
  L_EVALUATOR_SUMMON,
  L_WRAP_AND_RESTATE,
  L_HEDGE_DISTANCE,
  L_SELF_DIALOG,
  L_REASONING_STAGE,
  L_TIME_BEAT,
];

/**
 * すべてのレンズを 1 文に適用。
 * Phase 6 以降は analyzeOperations を 1 回呼び、各レンズはその結果を再投影する。
 * 引数 hits/frames は API 互換のため受け取るが未使用。
 */
export function applyLenses(text, _hits, _frames) {
  const ops = analyzeOperations(text);
  const readings = [];
  for (const lens of LENSES) {
    const spans = lens.detect(ops, text) || [];
    if (spans.length) {
      readings.push({
        lensId: lens.lensId,
        lensLabel: lens.lensLabel,
        lensColor: lens.lensColor,
        group: lens.group,
        spans,
      });
    }
  }
  const overlapByChar = new Array(text.length).fill(0);
  for (const r of readings) {
    for (const s of r.spans) {
      for (let i = s.start; i < s.end; i++) overlapByChar[i]++;
    }
  }
  const hotspots = [];
  let cur = null;
  for (let i = 0; i < overlapByChar.length; i++) {
    if (overlapByChar[i] >= 3) {
      if (!cur) cur = { start: i, end: i + 1, peak: overlapByChar[i] };
      else { cur.end = i + 1; cur.peak = Math.max(cur.peak, overlapByChar[i]); }
    } else if (cur) { hotspots.push(cur); cur = null; }
  }
  if (cur) hotspots.push(cur);
  return {
    readings,
    overlapByChar,
    hotspots: hotspots.map(h => ({
      ...h,
      surface: text.slice(h.start, h.end),
      lensCount: h.peak,
    })),
    totalLenses: readings.length,
    totalSpans: readings.reduce((a, r) => a + r.spans.length, 0),
  };
}
