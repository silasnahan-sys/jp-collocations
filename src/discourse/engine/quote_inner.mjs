// _tmp_pipeline/quote_inner.mjs
// Phase 4B: composition-of-quote 層
//
// 各 quoteFrame について、引用された命題 (citedSurface) を独立した
// ミニ文として再解析し、以下を組み立てる:
//
//   frame.innerHits[]        引用本体に対する hit (offset は引用本体相対)
//   frame.innerComposition[] 引用本体に対する構成素分解 (compose 済)
//   frame.innerStructure     {
//     predicate,             末尾述語 (動詞/名詞句)
//     predicateMode,         declarative / imperative / desiderative /
//                            interrogative / exclamative / fragment
//     polarity,              positive / negative / unknown
//     tense,                 past / present / unknown
//     subjectClue,           主語 (検出できれば) / null
//     addresseeParticles[],  ね / よ / じゃない / でしょ など
//     modalityClue,          かもしれない / だろう / べき / たい など
//     evidenceMarkers[]      らしい / みたい / そう / って 等
//   }
//   frame.innerNarrative     引用本体を 1 文の日本語注釈として
//
// 注意: 引用本体自体に op が立たない (filler/fragment) 場合も多い。
// その場合は innerHits=[] でも innerStructure は最大限埋める。

import { matchSentence } from './match.mjs';
import { assignVoicing } from './voicing.mjs';
import { composeSentence } from './compose.mjs';

const PREDICATE_TAIL_RE = /([一-龥ァ-ヶーぁ-ん]+(?:る|た|だ|です|ます|ました|ない|なかった|たい|たかった|てほしい|べき|そう|らしい|みたい|だろう|でしょう|かも|かな|よ|ね|か|の))$/;

const MODE_RULES = [
  { mode: 'imperative',   re: /(?:しろ|しなさい|してください|くれ|ろ|なよ|な)$/ },
  { mode: 'desiderative', re: /(?:たい|たかった|てほしい|てほしかった|ほしい)$/ },
  { mode: 'interrogative',re: /(?:か|の)\??$/ },
  { mode: 'exclamative',  re: /(?:ね|な|や|わ|ぞ)$/ },
];

const POLARITY_NEG_RE = /(?:ない|なかった|ません|ませんでした|ぬ|ず)$/;
const TENSE_PAST_RE   = /(?:た|だった|でした|ました)$/;

const SUBJECT_HEAD_RE = /([一-龥ァ-ヶーぁ-ん々]+?)(?:は|が|って|の)/;

const ADDRESSEE_PARTICLES = ['ね', 'よ', 'じゃない', 'じゃないですか', 'でしょ', 'でしょう', 'さ', 'って'];

const MODALITY_PATTERNS = [
  { tag: 'epistemic-may',     re: /(?:かもしれない|かもしれません|かも)$/ },
  { tag: 'epistemic-conjec',  re: /(?:だろう|でしょう)$/ },
  { tag: 'deontic-should',    re: /(?:べき|べきだ|べきです)$/ },
  { tag: 'desiderative',      re: /(?:たい|てほしい|ほしい)$/ },
  { tag: 'evidential-look',   re: /(?:そう|そうだ|みたい|らしい)$/ },
];

const EVIDENCE_PATTERNS = [
  { tag: 'hearsay-tte',       re: /って$/ },
  { tag: 'hearsay-sou',       re: /そうだ$|そうです$/ },
  { tag: 'inference-rashii',  re: /らしい$/ },
  { tag: 'visual-mitai',      re: /みたい(?:だ|です)?$/ },
];

/**
 * 引用本体テキストから innerStructure を組み立てる
 */
function buildInnerStructure(citedRaw) {
  const cited = (citedRaw || '').trim().replace(/^[「『]+|[」』]+$/g, '');
  const tail = cited.replace(/[。．！？!?\s]+$/, '');
  if (!tail) {
    return {
      predicate: '', predicateMode: 'fragment', polarity: 'unknown',
      tense: 'unknown', subjectClue: null, addresseeParticles: [],
      modalityClue: null, evidenceMarkers: [],
    };
  }
  // 述語末尾
  const predM = tail.match(PREDICATE_TAIL_RE);
  const predicate = predM ? predM[1] : tail.slice(-Math.min(4, tail.length));

  // モード判定
  let predicateMode = 'declarative';
  for (const r of MODE_RULES) {
    if (r.re.test(tail)) { predicateMode = r.mode; break; }
  }
  if (!predM && tail.length <= 4) predicateMode = 'fragment';

  const polarity = POLARITY_NEG_RE.test(tail) ? 'negative'
                : /[一-龥ぁ-んァ-ヶー]/.test(tail) ? 'positive'
                : 'unknown';
  // 末尾の対人助詞を一旦剥がしてから時制判定
  const stripped = tail.replace(/(?:よ|ね|な|わ|ぞ|さ|か|の)+$/, '');
  const tense = TENSE_PAST_RE.test(stripped) ? 'past' : 'present';

  // 主語手がかり (最も左の は/が/って で切る)
  let subjectClue = null;
  const sm = cited.match(SUBJECT_HEAD_RE);
  if (sm && sm[1].length <= 12) subjectClue = sm[1];

  // 対人助詞
  const addresseeParticles = ADDRESSEE_PARTICLES.filter(p => {
    const re = new RegExp(p + '[。．！？!?]?$');
    return re.test(tail);
  });

  // モダリティ手がかり
  let modalityClue = null;
  for (const m of MODALITY_PATTERNS) {
    if (m.re.test(tail)) { modalityClue = m.tag; break; }
  }

  // 証拠性マーカー
  const evidenceMarkers = EVIDENCE_PATTERNS
    .filter(e => e.re.test(tail))
    .map(e => e.tag);

  return {
    predicate, predicateMode, polarity, tense,
    subjectClue, addresseeParticles, modalityClue, evidenceMarkers,
  };
}

/**
 * 引用本体を独立文として再解析し、innerHits/innerComposition を作る
 */
function analyzeInnerCited(citedRaw) {
  const cited = (citedRaw || '').replace(/^[「『]+|[」』]+$/g, '');
  if (!cited.trim()) return { innerHits: [], innerComposition: [] };
  // mini match
  const mr = matchSentence(cited);
  const innerHits = assignVoicing(cited, mr.hits || []);
  composeSentence(cited, innerHits);
  const innerComposition = innerHits.map(h => ({
    opId: h.opId,
    surface: h.surface,
    offset: h.offset,
    constituents: h.constituents || [],
    compositionalNote: h.compositionalNote || '',
  }));
  return { innerHits, innerComposition };
}

/**
 * innerStructure + innerHits から人間可読な日本語ナラティブを作る
 */
function buildInnerNarrative(frame, innerStructure) {
  const bits = [];
  const modeLabel = ({
    declarative: '叙述',
    imperative: '命令',
    desiderative: '願望',
    interrogative: '疑問',
    exclamative: '感嘆',
    fragment: '断片',
  })[innerStructure.predicateMode] || innerStructure.predicateMode;
  bits.push(`【${modeLabel}】`);
  if (innerStructure.subjectClue) bits.push(`主語=「${innerStructure.subjectClue}」`);
  if (innerStructure.predicate) bits.push(`末尾述語=「${innerStructure.predicate}」`);
  bits.push(`極性=${innerStructure.polarity}・時制=${innerStructure.tense}`);
  if (innerStructure.modalityClue) bits.push(`モダリティ=${innerStructure.modalityClue}`);
  if (innerStructure.evidenceMarkers.length) {
    bits.push(`証拠性=${innerStructure.evidenceMarkers.join('/')}`);
  }
  if (innerStructure.addresseeParticles.length) {
    bits.push(`対人助詞=${innerStructure.addresseeParticles.join('/')}`);
  }
  if (frame.innerHits && frame.innerHits.length) {
    bits.push(`内部 op=${frame.innerHits.map(h => h.opId).join(', ')}`);
  } else {
    bits.push('内部 op 無し(下位 op が立たない裸の命題)');
  }
  bits.push(`声源=${frame.source}・修辞=${frame.rhetoricalUse}`);
  return bits.join(' / ');
}

/**
 * 全 quoteFrame に innerStructure / innerHits / innerComposition / innerNarrative を付与
 * @param {Array} frames  assignQuoteRelations が返した frames
 * @returns {Array}        同じ frames (in-place)
 */
export function decomposeQuoteFrames(frames) {
  for (const f of (frames || [])) {
    const inner = analyzeInnerCited(f.citedSurface);
    f.innerHits = inner.innerHits;
    f.innerComposition = inner.innerComposition;
    f.innerStructure = buildInnerStructure(f.citedSurface);
    f.innerNarrative = buildInnerNarrative(f, f.innerStructure);
  }
  return frames;
}

export const _internal = {
  buildInnerStructure,
  analyzeInnerCited,
  buildInnerNarrative,
};
