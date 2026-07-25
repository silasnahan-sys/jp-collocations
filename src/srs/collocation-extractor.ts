/**
 * collocation-extractor.ts — Comprehensive Japanese collocation extraction engine
 *
 * Detects ALL forms of collocations in Japanese text:
 *   - Verb + particle combos (食べに行く, 手を出す)
 *   - Compound verbs (走り出す, 書き直す)
 *   - Noun + する collocations (勉強する, 判断を下す)
 *   - Adjective + noun combos (明るい未来, 深い意味)
 *   - Idiomatic expressions (目が覚める, 腕を磨く)
 *   - Grammatical collocations (〜ざるを得ない, 〜に違いない)
 *   - Adverb + verb pairs (じっと見る, ゆっくり歩く)
 *   - Onomatopoeia + verb (ぺらぺら喋る, ぐっすり眠る)
 *   - Noun + particle + verb (気に入る, 手に入る)
 *   - Set phrases / four-char idioms (一石二鳥, 三日坊主)
 *   - Connective collocations (〜はもちろん〜も, 〜だけでなく〜も)
 *   - Compound particles (〜に対して, 〜に関して, 〜によると)
 *   - Auxiliary expressions (〜てしまう, 〜ておく, 〜てみる)
 *   - Keigo patterns (お〜になる, ご〜いただく)
 *   - Sentence-ending collocations (〜わけにはいかない, 〜ようがない)
 *
 * DESIGN: Runs without a morphological analyzer (no MeCab/kuromoji dependency).
 * Uses regex + heuristic chunking optimized for mobile performance.
 */

import { isKanji, isHiragana, isKatakana } from '../utils/japanese.ts';

// ══════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════

export interface ExtractedCollocation {
  /** The full collocation surface form as found in text */
  surface: string;
  /** Start char offset in source text */
  start: number;
  /** End char offset */
  end: number;
  /** What kind of collocation */
  type: CollocationPattern;
  /** Confidence 0–1 */
  confidence: number;
  /** The "core" word (headword candidate) */
  core: string;
  /** The bound/dependent part */
  bound: string;
  /** Human-readable pattern label */
  patternLabel: string;
  /** English description of the pattern */
  patternLabelEn: string;
}

export type CollocationPattern =
  | 'verb-particle'       // 食べに行く, 出かけてくる
  | 'compound-verb'       // 走り出す, 書き直す
  | 'noun-suru'           // 勉強する, 判断する
  | 'noun-particle-verb'  // 気に入る, 手を出す
  | 'adj-noun'            // 明るい未来, 深い意味
  | 'adv-verb'            // じっと見る, ゆっくり歩く
  | 'onomatopoeia-verb'   // ぺらぺら喋る, ぐっすり眠る
  | 'grammatical'         // 〜ざるを得ない, 〜に違いない
  | 'compound-particle'   // 〜に対して, 〜によると
  | 'auxiliary'           // 〜てしまう, 〜ておく
  | 'keigo'               // お〜になる, ご〜いただく
  | 'sentence-end'        // 〜わけにはいかない
  | 'set-phrase'          // 一石二鳥, 四面楚歌
  | 'connective'          // 〜はもちろん〜も
  | 'idiomatic';          // 目が覚める, 腕を磨く

// ══════════════════════════════════════════════════════════════
// PATTERN DATABASES (regex-based, no morphological analyzer)
// ══════════════════════════════════════════════════════════════

// Helper: match kanji block
const K = '[\\u4e00-\\u9faf\\u3400-\\u4dbf]';
// Hiragana block
const H = '[\\u3041-\\u3096]';
// Katakana block
const KT = '[\\u30a1-\\u30f6ー]';
// Any JP char
const JP = `(?:${K}|${H}|${KT})`;

interface PatternRule {
  type: CollocationPattern;
  regex: RegExp;
  label: string;
  labelEn: string;
  confidence: number;
  /** Extract core and bound parts from match groups */
  extract: (m: RegExpExecArray) => { core: string; bound: string };
}

const PATTERN_RULES: PatternRule[] = [
  // ── Compound verbs (V連用形 + V) ──────────────────────────
  {
    type: 'compound-verb',
    regex: new RegExp(`(${K}${H}*?)(出す|始める|続ける|終わる|直す|合う|込む|切る|抜く|過ぎる|返す|かける|損ねる|忘れる|慣れる|飽きる|果てる|尽くす|まくる)`, 'g'),
    label: '複合動詞',
    labelEn: 'Compound verb',
    confidence: 0.9,
    extract: m => ({ core: m[1] + m[2], bound: m[2] }),
  },
  // ── Noun + する ────────────────────────────────────────────
  {
    type: 'noun-suru',
    regex: new RegExp(`(${K}{1,4})(する|した|して|しない|しよう|すれば|します|しました|できる|できない|させる|される)`, 'g'),
    label: '名詞＋する',
    labelEn: 'Noun + suru',
    confidence: 0.85,
    extract: m => ({ core: m[1], bound: m[2] }),
  },
  // ── Noun + particle + verb (body-part idioms etc) ─────────
  {
    type: 'noun-particle-verb',
    regex: new RegExp(`(${K}{1,3})(を|に|が|は|で|と|から|まで)(${K}${H}+)`, 'g'),
    label: '名詞＋助詞＋動詞',
    labelEn: 'N + particle + V',
    confidence: 0.7,
    extract: m => ({ core: m[1] + m[2] + m[3], bound: m[2] }),
  },
  // ── Adjective + noun ──────────────────────────────────────
  {
    type: 'adj-noun',
    regex: new RegExp(`(${K}${H}*い|${K}+な)(${K}{1,4})`, 'g'),
    label: '形容詞＋名詞',
    labelEn: 'Adj + Noun',
    confidence: 0.65,
    extract: m => ({ core: m[2], bound: m[1] }),
  },
  // ── Compound particles ────────────────────────────────────
  {
    type: 'compound-particle',
    regex: /(?:に対して|に関して|によると|によれば|において|にとって|にかけて|について|をもって|に基づいて|に沿って|のもとで|に伴って|に先立って|を通じて|を通して|をめぐって|に応じて|にわたって|にかかわらず|にもかかわらず|を除いて|のほかに)/g,
    label: '複合助詞',
    labelEn: 'Compound particle',
    confidence: 0.95,
    extract: m => ({ core: m[0], bound: '' }),
  },
  // ── Auxiliary verb chains (て-form + auxiliary) ────────────
  {
    type: 'auxiliary',
    regex: new RegExp(`(${K}${H}*?て|${K}${H}*?で)(しまう|しまった|おく|おいた|みる|みた|いく|いった|くる|きた|ある|あった|いる|いた|もらう|あげる|くれる|やる|やった|ほしい)`, 'g'),
    label: '補助動詞',
    labelEn: 'Auxiliary verb',
    confidence: 0.88,
    extract: m => ({ core: m[1] + m[2], bound: m[2] }),
  },
  // ── Onomatopoeia + verb ───────────────────────────────────
  {
    type: 'onomatopoeia-verb',
    regex: new RegExp(`((?:${H}{2}${H}{2}|${KT}{2}${KT}{2}))(と|に)?(${K}${H}+)`, 'g'),
    label: 'オノマトペ＋動詞',
    labelEn: 'Onomatopoeia + V',
    confidence: 0.75,
    extract: m => ({ core: m[3], bound: m[1] }),
  },
  // ── Keigo patterns ────────────────────────────────────────
  {
    type: 'keigo',
    regex: new RegExp(`(お${K}${H}*になる|お${K}${H}*する|お${K}${H}*ください|ご${K}+になる|ご${K}+する|ご${K}+ください|ご${K}+いただ[くけき]|お${K}${H}*いただ[くけき]|お${K}${H}*申し上げる|ご${K}+申す)`, 'g'),
    label: '敬語表現',
    labelEn: 'Keigo',
    confidence: 0.92,
    extract: m => ({ core: m[0], bound: '' }),
  },
  // ── Grammatical collocations ──────────────────────────────
  {
    type: 'grammatical',
    regex: /(?:ざるを得ない|に違いない|に決まっている|ようがない|しようがない|わけにはいかない|ないわけにはいかない|どころではない|ほかない|ほかはない|ことはない|にほかならない|に過ぎない|ではないか|のではないか|てならない|てたまらない|てしょうがない|てしかたがない|かねない|かねる|ぬきにしては|をおいて|をよそに|はおろか|はもとより|はさておき|ともかく|といっても|とはいえ|とは限らない|べきだ|べきではない|はずがない|はずだ|ものだ|ものではない|ことになっている|ことにしている|ことがある|ことができる|ようにする|ようになる|つもりだ|ことだ|ものか|ものの|ところだ|ばかりだ|たばかりだ|ところが|ところで|どころか|くせに|わりに|反面|一方で|にしても|としても|にしろ|にせよ|からといって|からこそ|ばこそ|さえ.?ば|でも.?ば|とすれば|とすると|としたら|たとしても)/g,
    label: '文法コロケーション',
    labelEn: 'Grammatical collocation',
    confidence: 0.93,
    extract: m => ({ core: m[0], bound: '' }),
  },
  // ── Sentence-ending patterns ──────────────────────────────
  {
    type: 'sentence-end',
    regex: /(?:わけだ|わけです|わけがない|ものだから|もので|ものですから|ことだから|ことから|ことだし|しかない|にすぎない|ではないだろうか|のではなかろうか|と言えよう|と言えるだろう|に他ならない|に相違ない|てやまない|に堪えない|極まりない|極まる|の至りだ|の限りだ|に耐えない|を禁じ得ない|ずにはいられない|ないではいられない|ずにはおかない|ないではおかない|を余儀なくされる|を余儀なくさせる)/g,
    label: '文末表現',
    labelEn: 'Sentence-end pattern',
    confidence: 0.91,
    extract: m => ({ core: m[0], bound: '' }),
  },
  // ── Adverb + verb common pairs ────────────────────────────
  {
    type: 'adv-verb',
    regex: /(?:じっと見|ゆっくり歩|はっきり言|しっかり握|ぐっすり眠|ぴったり合|すっかり忘|うっかり|ちゃんと|きちんと|ちょっと|なかなか|たっぷり|ぎりぎり|そっと|ふと|つい|ぜひ|きっと|必ず|かなり|すごく|とても|めっちゃ|まったく|全然|絶対に|思わず|急に|突然|いきなり|やっと|ようやく|ついに|とうとう|だんだん|次第に|思いっきり|一生懸命|精一杯)/g,
    label: '副詞＋動詞',
    labelEn: 'Adverb + Verb',
    confidence: 0.72,
    extract: m => ({ core: m[0], bound: '' }),
  },
  // ── Connective collocations ───────────────────────────────
  {
    type: 'connective',
    regex: /(?:はもちろん.{0,8}も|だけでなく.{0,8}も|のみならず.{0,8}も|ばかりでなく.{0,8}も|に限らず.{0,8}も|はともかく.{0,8}は|であれ.{0,8}であれ|にしろ.{0,8}にしろ|にせよ.{0,8}にせよ|も.{0,8}も.{0,8}も|が.{0,8}たり.{0,8}たり)/g,
    label: '連結コロケーション',
    labelEn: 'Connective collocation',
    confidence: 0.78,
    extract: m => ({ core: m[0], bound: '' }),
  },
  // ── Set phrases / 四字熟語 ────────────────────────────────
  {
    type: 'set-phrase',
    regex: new RegExp(`(${K}{4})`, 'g'),
    label: '四字熟語候補',
    labelEn: 'Four-kanji compound',
    confidence: 0.5, // low confidence, needs filtering
    extract: m => ({ core: m[1], bound: '' }),
  },
];

// Known 四字熟語 for confidence boost
const KNOWN_YOJIJUKUGO = new Set([
  '一石二鳥','以心伝心','一期一会','一進一退','一朝一夕','一長一短',
  '因果応報','我田引水','起死回生','自業自得','弱肉強食','四面楚歌',
  '七転八倒','試行錯誤','十人十色','前代未聞','大同小異','天真爛漫',
  '二束三文','半信半疑','付和雷同','本末転倒','無我夢中','臨機応変',
  '理路整然','竜頭蛇尾','老若男女','和洋折衷','一目瞭然','異口同音',
  '意気投合','一触即発','温故知新','花鳥風月','完全無欠','危機一髪',
  '疑心暗鬼','言語道断','公明正大','五里霧中','三寒四温','質実剛健',
  '首尾一貫','針小棒大','青天白日','千差万別','朝三暮四','電光石火',
  '独立独歩','馬耳東風','八方美人','百発百中','不言実行','傍若無人',
  '満場一致','門前払い','油断大敵','優柔不断','有名無実','利害関係',
]);

// ══════════════════════════════════════════════════════════════
// MAIN EXTRACTION FUNCTION
// ══════════════════════════════════════════════════════════════

/**
 * Extract all collocations from a text.
 * Returns deduplicated, non-overlapping results sorted by confidence.
 */
export function extractCollocations(text: string): ExtractedCollocation[] {
  const results: ExtractedCollocation[] = [];

  for (const rule of PATTERN_RULES) {
    // Reset regex state
    rule.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.regex.exec(text)) !== null) {
      const surface = m[0];
      const start = m.index;
      const end = start + surface.length;
      let confidence = rule.confidence;

      // Boost confidence for known set phrases
      if (rule.type === 'set-phrase') {
        if (KNOWN_YOJIJUKUGO.has(surface)) {
          confidence = 0.95;
        } else {
          // Skip unknown 4-kanji sequences — too many false positives
          continue;
        }
      }

      // Skip very short matches that are likely noise
      if (surface.length < 2) continue;

      // For N+particle+V, boost if it's a known body-part idiom pattern
      if (rule.type === 'noun-particle-verb') {
        const bodyParts = new Set(['手','目','耳','口','首','腕','足','頭','顔','胸','腹','背','鼻','肩','心','気','力','身','息']);
        const { core } = rule.extract(m);
        const firstKanji = core.charAt(0);
        if (bodyParts.has(firstKanji)) {
          confidence = Math.min(confidence + 0.15, 0.95);
        }
      }

      const { core, bound } = rule.extract(m);

      results.push({
        surface,
        start,
        end,
        type: rule.type,
        confidence,
        core,
        bound,
        patternLabel: rule.label,
        patternLabelEn: rule.labelEn,
      });
    }
  }

  // Deduplicate: remove overlapping spans, keeping highest confidence
  results.sort((a, b) => b.confidence - a.confidence);
  const kept: ExtractedCollocation[] = [];
  const occupied = new Set<number>();

  for (const r of results) {
    let overlap = false;
    for (let i = r.start; i < r.end; i++) {
      if (occupied.has(i)) { overlap = true; break; }
    }
    if (overlap) continue;
    kept.push(r);
    for (let i = r.start; i < r.end; i++) occupied.add(i);
  }

  // Sort by text position
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

/**
 * Extract collocations and return the single best match for a highlighted phrase.
 * Used when user selects text and we need to identify what the "collocation" is.
 */
export function identifyCollocationInSelection(
  selection: string,
  contextBefore: string,
  contextAfter: string,
): ExtractedCollocation | null {
  // Search in the full context window
  const fullContext = contextBefore + selection + contextAfter;
  const selStart = contextBefore.length;
  const selEnd = selStart + selection.length;
  const all = extractCollocations(fullContext);

  // Find collocations that overlap with the selection
  const overlapping = all.filter(c => c.start < selEnd && c.end > selStart);

  if (overlapping.length === 0) return null;

  // Prefer the one most centered on the selection
  overlapping.sort((a, b) => {
    // Prefer higher confidence
    const confDiff = b.confidence - a.confidence;
    if (Math.abs(confDiff) > 0.1) return confDiff;
    // Prefer more overlap with selection
    const overlapA = Math.min(a.end, selEnd) - Math.max(a.start, selStart);
    const overlapB = Math.min(b.end, selEnd) - Math.max(b.start, selStart);
    return overlapB - overlapA;
  });

  return overlapping[0];
}

/**
 * Given a collocation surface, generate a cloze blank version.
 * The "core" is kept visible, the "bound" is blanked.
 * If the collocation has no clear bound/core split, blank the whole thing.
 */
export function makeCollocationCloze(colloc: ExtractedCollocation): {
  clozeText: string;
  answer: string;
} {
  if (colloc.bound && colloc.bound.length > 0) {
    // Blank out the bound part within the surface
    const blanked = colloc.surface.replace(colloc.bound, '＿'.repeat(colloc.bound.length));
    return { clozeText: blanked, answer: colloc.bound };
  }
  // Blank the whole surface
  return { clozeText: '＿'.repeat(colloc.surface.length), answer: colloc.surface };
}
