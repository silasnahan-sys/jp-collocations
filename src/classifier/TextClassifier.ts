import { PartOfSpeech } from "../types.ts";

// ---------------------------------------------------------------------------
// Data tables
// ---------------------------------------------------------------------------

/** Extensive list of common な-adjectives (without な). */
const NA_ADJECTIVES = new Set([
  "静か", "大切", "不思議", "必要", "大丈夫", "簡単", "重要", "有名", "大変", "元気",
  "丁寧", "親切", "便利", "複雑", "特別", "普通", "自由", "安全", "危険", "適当",
  "十分", "微妙", "明確", "曖昧", "劇的", "急激", "中途半端", "的", "素直", "上手",
  "下手", "好き", "嫌い", "得意", "苦手", "大好き", "完全", "正確", "暖か", "賑やか",
  "穏やか", "豊か", "愉快", "不愉快", "綺麗", "きれい", "素敵", "素晴らし", "ハンサム",
  "親密", "重大", "深刻", "緊急", "高度", "精密", "高尚", "幸福", "幸せ",
  "不幸", "残念", "可能", "不可能", "明らか", "確か", "不確か", "当然", "自然",
  "不自然", "真剣", "真面目", "不真面目", "積極的", "消極的", "具体的", "抽象的",
  "一般的", "特定", "多様", "均一", "同様", "異様", "合法", "違法", "有効", "無効",
  "適切", "不適切", "合理的", "非合理的", "理想的", "現実的", "論理的", "感情的",
  "客観的", "主観的", "相対的", "絶対的", "基本的", "応用的", "専門的", "技術的",
  "歴史的", "伝統的", "革新的", "典型的", "例外的", "公式", "非公式", "正式",
  "平和", "安定", "不安定", "健康", "不健康", "清潔", "不潔", "快適", "不快",
]);

/** Common する-verb prefixes. */
const SURU_VERBS = new Set([
  "勉強", "研究", "調査", "批判", "発達", "発展", "発生", "発見", "発明", "発表",
  "説明", "確認", "確保", "確立", "対応", "対策", "対象", "検討", "検査", "検証",
  "分析", "分類", "分解", "理解", "解決", "解説", "解釈", "記録", "記述", "記憶",
  "整理", "整備", "整合", "比較", "比喩", "参考", "参照", "参加", "判断",
  "判明", "判定", "評価", "評論", "表現", "表示", "表記", "報告", "報道", "通報",
  "実施", "実行", "実現", "実験", "実感", "設定", "設立", "設置", "設計",
  "管理", "監視", "監督", "修正", "修理", "修了", "完成", "完了", "開始", "開発",
  "利用", "活用", "活動", "使用", "操作", "制御", "制作", "制限", "製作", "製造",
  "反映", "反応", "反省", "反対", "賛成", "主張", "主導", "強調", "強制", "支援",
  "支持", "支配", "指摘", "指示", "指導", "紹介", "提供", "提案", "提示",
  "要求", "要望", "要約", "準備", "予定", "予測", "予防", "防止", "防衛", "保護",
  "保証", "保存", "保管", "維持", "運営", "運用", "採用", "採取", "収集", "収録",
  "注目", "注意", "集中", "集計", "観察", "観測", "体験", "経験", "調整", "調節",
  "転換", "変換", "変更", "変化", "進化", "進行", "進歩", "促進", "推進", "普及",
  "拡大", "縮小", "増加", "減少", "向上", "改善", "改革", "推薦", "引用", "批判",
  "批評", "否定", "肯定", "承認", "否定", "消費", "生産", "流通", "販売", "購入",
  "投資", "貯蓄", "融資", "損失", "利益", "計算", "測定", "評定", "競争", "協力",
  "協議", "協調", "統合", "連携", "連絡", "接続", "切断", "分離", "合併", "統一",
]);

/** Colloquial contraction patterns: [spoken, standard] */
const COLLOQUIAL_FORMS: Array<[RegExp, string]> = [
  [/てる/g, "ている"],
  [/でる/g, "でいる"],
  [/ってた/g, "と言っていた"],
  [/てた/g, "ていた"],
  [/でた/g, "でいた"],
  [/じゃ/g, "では"],
  [/んだ/g, "のだ"],
  [/んです/g, "のです"],
  [/っぽい/g, "らしい"],
  [/やっぱ(?!り)/g, "やはり"],
  [/やっぱり/g, "やはり"],
  [/ちょっと/g, "少し"],
  [/すごい/g, "とても"],
  [/めっちゃ/g, "とても"],
  [/超([^\s])/g, "とても$1"],
];

/** Honorific verb list for register detection. */
const HONORIFIC_VERBS = [
  "いらっしゃる", "おっしゃる", "なさる", "ございます", "いただく", "くださる",
  "申し上げる", "伺う", "拝見", "ご覧", "お〜になる", "〜られる",
];

/** Slang terms. */
const SLANG_WORDS = [
  "ボロカス", "パチ", "やばい", "やべ", "ムカつく", "ウザい", "キモい", "ダサい",
  "イケてる", "ウケる", "チョベリバ", "ぱちこく", "パチこく",
];

/** Dialect markers. */
const DIALECT_MARKERS = [
  "パチこく", "パチこいてる", "〜へん", "〜やん", "〜やろ", "〜ちゃう", "〜やな",
  "〜はる", "〜でんがな", "〜どす", "〜ずら", "〜べ", "〜だべ", "〜じゃ",
];

/** Academic/linguistics domain words. */
const ACADEMIC_WORDS = [
  "文法", "品詞", "テンス", "アスペクト", "形態素", "語彙", "語用", "意味",
  "音韻", "統語", "談話", "コーパス", "分析", "研究", "論文", "仮説", "批判",
  "記述", "調査", "言語学", "言語", "引用", "標準", "規則", "規範", "体系",
  "データ", "理論", "モデル", "フレーム", "スキーマ", "構造", "特徴", "機能",
  "分類", "類型", "比較", "対照", "歴史", "変化", "発達", "習得", "教授",
];

/** Body-related words. */
const BODY_WORDS = [
  "手", "目", "足", "顔", "頭", "心", "体", "耳", "口", "鼻", "肩", "腕", "背",
  "胸", "腹", "腰", "指", "爪", "歯", "舌", "唇", "眉", "ひげ", "髪",
];

/** Emotional words. */
const EMOTION_WORDS = [
  "気", "心", "感", "喜", "悲", "怒", "恐", "愛", "嫌", "好", "楽", "辛", "苦",
  "嬉しい", "悲しい", "怒る", "怖い", "愛する", "嫌い", "好き", "楽しい",
  "辛い", "苦しい", "寂しい", "恥ずかしい", "驚く", "感動", "感謝", "後悔",
];

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  /** The original selected text. */
  originalText: string;
  /** Normalised (de-contracted) form for storage. */
  normalisedText: string;
  headword: string;
  collocate: string;
  fullPhrase: string;
  headwordPOS: PartOfSpeech;
  collocatePOS: PartOfSpeech;
  pattern: string;
  tags: string[];
  notes: string;
  frequency: number;
  /** 0–100 confidence in the classification. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

export class TextClassifier {
  classify(text: string): ClassificationResult {
    const trimmed = text.trim();
    const tags: string[] = [];
    const notesParts: string[] = [];
    let confidence = 50;

    // -----------------------------------------------------------------------
    // 1. Colloquial / spoken form detection
    // -----------------------------------------------------------------------
    const colloquialDetected = this.detectColloquial(trimmed);
    if (colloquialDetected.length > 0) {
      tags.push("口語");
      notesParts.push("口語形: " + colloquialDetected.join(", "));
    }

    // -----------------------------------------------------------------------
    // 2. Register / formality
    // -----------------------------------------------------------------------
    const register = this.detectRegister(trimmed);
    if (register) tags.push(register);

    // -----------------------------------------------------------------------
    // 3. Phrase structure & headword/collocate split
    // -----------------------------------------------------------------------
    const structure = this.detectStructure(trimmed);
    const { headword, collocate, pattern, headwordPOS, collocatePOS } = structure;

    if (structure.confidence > 0) confidence = Math.min(95, confidence + structure.confidence);

    // -----------------------------------------------------------------------
    // 4. Semantic domain tags
    // -----------------------------------------------------------------------
    const domainTags = this.detectDomains(trimmed, headword, collocate);
    for (const t of domainTags) if (!tags.includes(t)) tags.push(t);

    // -----------------------------------------------------------------------
    // 5. Formality normalised text
    // -----------------------------------------------------------------------
    const normalisedText = this.normalise(trimmed);

    // -----------------------------------------------------------------------
    // 6. Frequency scoring
    // -----------------------------------------------------------------------
    const frequency = this.scoreFrequency(trimmed, tags, pattern);

    return {
      originalText: trimmed,
      normalisedText,
      headword,
      collocate,
      fullPhrase: trimmed,
      headwordPOS,
      collocatePOS,
      pattern,
      tags,
      notes: notesParts.join("; "),
      frequency,
      confidence,
    };
  }

  // ---------------------------------------------------------------------------
  // Colloquial detection
  // ---------------------------------------------------------------------------

  private detectColloquial(text: string): string[] {
    const found: string[] = [];
    if (/てる/.test(text))   found.push("てる→ている");
    // でる as contraction of でいる: only when NOT preceded by 出 (i.e. verb 出る)
    if (/[^出]でる/.test(text) || text.startsWith("でる")) found.push("でる→でいる");
    if (/ってた/.test(text)) found.push("ってた→と言っていた");
    if (/てた/.test(text) && !/ってた/.test(text)) found.push("てた→ていた");
    if (/じゃ/.test(text))   found.push("じゃ→では");
    if (/んだ/.test(text))   found.push("んだ→のだ");
    if (/んです/.test(text)) found.push("んです→のです");
    if (/っぽい/.test(text)) found.push("っぽい→らしい");
    if (/やっぱ/.test(text)) found.push("やっぱ→やはり");
    return found;
  }

  // ---------------------------------------------------------------------------
  // Register detection
  // ---------------------------------------------------------------------------

  private detectRegister(text: string): string | null {
    // Check slang first (highest specificity)
    if (SLANG_WORDS.some(w => text.includes(w))) return "俗語";
    // Check dialect
    if (DIALECT_MARKERS.some(w => text.includes(w))) return "方言";
    // Check honorific
    if (HONORIFIC_VERBS.some(w => text.includes(w))) return "敬語";
    // Polite: ends in ます/です forms (explicit checks, no over-broad regex)
    if (text.endsWith("です") || text.endsWith("ます") ||
        text.endsWith("ました") || text.endsWith("ません") ||
        text.endsWith("でした")) return "丁寧語";
    // Plain form
    if (/[うくぐすつぬぶむる]$/.test(text) || text.endsWith("だ") ||
        /[いかけがきさしたちなにのはひふへほまみめもやゆよらりれろわ]$/.test(text)) {
      return "普通体";
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Phrase structure detection
  // ---------------------------------------------------------------------------

  private detectStructure(text: string): {
    headword: string;
    collocate: string;
    pattern: string;
    headwordPOS: PartOfSpeech;
    collocatePOS: PartOfSpeech;
    confidence: number;
  } {
    // --- Pattern: N+する (suru-verb) ---
    for (const sv of SURU_VERBS) {
      if (text.startsWith(sv) && (text === sv + "する" || text === sv + "した" ||
          text === sv + "して" || text === sv + "しない" || text === sv + "している" ||
          text === sv + "してる" || text === sv + "した結果" || text.startsWith(sv + "する"))) {
        const rest = text.slice(sv.length);
        return {
          headword: sv,
          collocate: "する" + (rest.startsWith("する") ? rest.slice(2) : rest),
          pattern: rest.includes("結果") ? "N+する+N" : "N+する",
          headwordPOS: PartOfSpeech.Noun,
          collocatePOS: PartOfSpeech.Verb,
          confidence: 30,
        };
      }
    }

    // --- Pattern: Quote+と+V (〜と思う、〜と言う) ---
    const quoteMatch = text.match(/^(.+?)[とって]([思言見考感聞][\S]*)$/);
    if (quoteMatch) {
      return {
        headword: quoteMatch[1],
        collocate: "と" + quoteMatch[2],
        pattern: "Quote+と+V",
        headwordPOS: PartOfSpeech.Expression,
        collocatePOS: PartOfSpeech.Verb,
        confidence: 20,
      };
    }

    // --- Pattern: V+passive+てる/てた/ている (言われてる, 書かれてた) ---
    const passiveTeiru = text.match(/^([\s\S]+?)([わかされ]れて[るたいいた]*)$/);
    if (passiveTeiru) {
      const verbBase = this.extractVerbBase(passiveTeiru[1] + "れ");
      const suffix = passiveTeiru[2].replace(/^[わかされ]れ/, "");
      const hasTe = suffix.startsWith("て");
      return {
        headword: verbBase || passiveTeiru[1],
        collocate: "passive" + (hasTe ? "+" + suffix : ""),
        pattern: hasTe ? "V+passive+て" + suffix.slice(1) : "V+passive",
        headwordPOS: PartOfSpeech.Verb,
        collocatePOS: PartOfSpeech.AuxVerb,
        confidence: 25,
      };
    }

    // --- Pattern: V+causative (させられる) ---
    if (/させられ/.test(text)) {
      const base = text.replace(/させられ.*$/, "");
      return {
        headword: base || text,
        collocate: "させられる",
        pattern: "V+causative+passive",
        headwordPOS: PartOfSpeech.Verb,
        collocatePOS: PartOfSpeech.AuxVerb,
        confidence: 25,
      };
    }

    // --- Pattern: V+ていた/ていた (contracted: てた/でた) ---
    const teitaMatch = text.match(/^([\s\S]+?)(て(?:い)?た|で(?:い)?た)$/);
    if (teitaMatch && teitaMatch[1].length > 0) {
      const verbPart = teitaMatch[1];
      if (/[うくぐすつぬぶむるく]$|んで$|って$|いて$|いで$/.test(verbPart)) {
        return {
          headword: verbPart,
          collocate: teitaMatch[2],
          pattern: "V+ていた",
          headwordPOS: PartOfSpeech.Verb,
          collocatePOS: PartOfSpeech.AuxVerb,
          confidence: 20,
        };
      }
    }

    // --- Pattern: V+て+V compound (書いてある, 考えてみる, 割れてる) ---
    const teVMatch = text.match(/^([\s\S]+?)(て(?:い)?(?:[るみあおい]|ある|いる|みる|おく|しまう|くる))/);
    if (teVMatch && teVMatch[1].length > 0) {
      const head = teVMatch[1];
      const tail = teVMatch[2];
      return {
        headword: head,
        collocate: tail,
        pattern: "V+て+V",
        headwordPOS: PartOfSpeech.Verb,
        collocatePOS: PartOfSpeech.Verb,
        confidence: 20,
      };
    }

    // --- Pattern: naAdj+に+V (劇的に変わった, 急激に発達する) ---
    const naAdjNiV = text.match(/^([^\s]+?)に([^\s]+)$/);
    if (naAdjNiV) {
      const adj = naAdjNiV[1];
      const verb = naAdjNiV[2];
      if (NA_ADJECTIVES.has(adj) || adj.endsWith("的")) {
        return {
          headword: adj,
          collocate: "に" + verb,
          pattern: "naAdj+に+V",
          headwordPOS: PartOfSpeech.Adjective_na,
          collocatePOS: PartOfSpeech.Verb,
          confidence: 30,
        };
      }
    }

    // --- Pattern: N+が+Adj (引用が雑, 気が重い) ---
    const nGaAdj = text.match(/^([^\s]+?)が([^\s]+[いなか](?:だ|です|った)?)$/);
    if (nGaAdj && !nGaAdj[2].match(/[うくぐすつぬぶむる]$/)) {
      const adj = nGaAdj[2];
      const posAdj = this.detectWordPOS(adj);
      if (posAdj === PartOfSpeech.Adjective_i || posAdj === PartOfSpeech.Adjective_na ||
          NA_ADJECTIVES.has(adj) || NA_ADJECTIVES.has(adj.replace(/だ$|です$/, ""))) {
        return {
          headword: nGaAdj[1],
          collocate: "が" + adj,
          pattern: "N+が+naAdj",
          headwordPOS: PartOfSpeech.Noun,
          collocatePOS: posAdj,
          confidence: 20,
        };
      }
    }

    // --- Pattern: Adv+V (じっくり進む, はっきり言う) ---
    const advVMatch = text.match(/^([^\s]+?り|[^\s]+?と)([^\s]+[うくぐすつぬぶむる](?:.*?)?)$/);
    if (advVMatch && advVMatch[1].length >= 2 && advVMatch[2].length >= 1) {
      const adv = advVMatch[1];
      const verb = advVMatch[2];
      if (/り$|と$/.test(adv) && this.looksLikeAdverb(adv)) {
        return {
          headword: adv,
          collocate: verb,
          pattern: "Adv+V",
          headwordPOS: PartOfSpeech.Adverb,
          collocatePOS: PartOfSpeech.Verb,
          confidence: 20,
        };
      }
    }

    // --- Pattern: N+の+N (時間の無駄, 言語の壁) ---
    const nNoN = text.match(/^([^\s]+?)の([^\s]+)$/);
    if (nNoN && nNoN[1].length >= 1 && nNoN[2].length >= 1) {
      return {
        headword: nNoN[1],
        collocate: "の" + nNoN[2],
        pattern: "N+の+N",
        headwordPOS: PartOfSpeech.Noun,
        collocatePOS: PartOfSpeech.Noun,
        confidence: 15,
      };
    }

    // --- Pattern: N+を+V (手を打つ, 炎上を消す) ---
    const nWoV = text.match(/^([^\s]+?)を([^\s]+)$/);
    if (nWoV) {
      return {
        headword: nWoV[1],
        collocate: "を" + nWoV[2],
        pattern: "N+を+V",
        headwordPOS: PartOfSpeech.Noun,
        collocatePOS: PartOfSpeech.Verb,
        confidence: 25,
      };
    }

    // --- Pattern: N+が+V (風が吹く, 時間かかって) ---
    const nGaV = text.match(/^([^\s]+?)が([^\s]+)$/);
    if (nGaV) {
      return {
        headword: nGaV[1],
        collocate: "が" + nGaV[2],
        pattern: "N+が+V",
        headwordPOS: PartOfSpeech.Noun,
        collocatePOS: PartOfSpeech.Verb,
        confidence: 25,
      };
    }

    // --- Pattern: N+に+V (気に入る) ---
    const nNiV = text.match(/^([^\s]+?)に([^\s]+)$/);
    if (nNiV) {
      return {
        headword: nNiV[1],
        collocate: "に" + nNiV[2],
        pattern: "N+に+V",
        headwordPOS: PartOfSpeech.Noun,
        collocatePOS: PartOfSpeech.Verb,
        confidence: 20,
      };
    }

    // --- Pattern: N+V (ボロカス言われてる — no particle, spoken) ---
    // Fallback: try to split on the first verb-like character
    const fallback = this.fallbackSplit(text);
    return {
      headword: fallback.headword,
      collocate: fallback.collocate,
      pattern: fallback.pattern,
      headwordPOS: PartOfSpeech.Noun,
      collocatePOS: PartOfSpeech.Verb,
      confidence: 10,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Detect POS for a single word (used for collocates). */
  private detectWordPOS(word: string): PartOfSpeech {
    if (!word) return PartOfSpeech.Other;
    const clean = word.replace(/だ$|です$|でした$|だった$/, "");
    if (NA_ADJECTIVES.has(clean) || clean.endsWith("的")) return PartOfSpeech.Adjective_na;
    if (/[うくぐすつぬぶむる]$/.test(word)) return PartOfSpeech.Verb;
    if (word.endsWith("い")) return PartOfSpeech.Adjective_i;
    if (word.endsWith("に") || word.endsWith("と")) return PartOfSpeech.Adverb;
    return PartOfSpeech.Noun;
  }

  /** Extract verb base (dictionary form) from a passivised/conjugated form. */
  private extractVerbBase(conjugated: string): string {
    // Simple heuristic: remove passive suffix
    return conjugated
      .replace(/[わかされ]れる?$/, "う") // godan passive → dict
      .replace(/られる?$/, "る")          // ichidan passive
      .replace(/れる?$/, "る")            // fallback
      .replace(/て$/, "");
  }

  /** Heuristic: does a string look like a Japanese adverb? */
  private looksLikeAdverb(s: string): boolean {
    const knownAdverbs = [
      "じっくり", "はっきり", "ゆっくり", "しっかり", "ぎっしり", "ざっくり",
      "さっぱり", "すっきり", "たっぷり", "びっくり", "ふっくら", "ぼんやり",
      "まったり", "のんびり", "きっぱり", "てっきり", "うっかり", "ちゃっかり",
      "じっと", "ぼーっと", "ぼんやりと", "はっと", "ふと", "すっと",
      "もっと", "ずっと", "きっと", "もともと", "たとえば",
    ];
    return knownAdverbs.some(a => s.startsWith(a) || s === a);
  }

  /** Fallback: split the phrase into a head noun/word and a verb tail. */
  private fallbackSplit(text: string): { headword: string; collocate: string; pattern: string } {
    // If 2–3 chars, treat as single unit
    if (text.length <= 3) {
      return { headword: text, collocate: "", pattern: "V" };
    }
    // Try: first kanji/kana word as headword, rest as collocate
    const m = text.match(/^([\u4e00-\u9fafぁ-ゖァ-ヶ]{1,4})([\s\S]+)$/);
    if (m) {
      return { headword: m[1], collocate: m[2], pattern: "N+V" };
    }
    // Last resort
    const mid = Math.floor(text.length / 2);
    return {
      headword: text.slice(0, mid),
      collocate: text.slice(mid),
      pattern: "phrase",
    };
  }

  // ---------------------------------------------------------------------------
  // Domain tagging
  // ---------------------------------------------------------------------------

  private detectDomains(text: string, headword: string, collocate: string): string[] {
    const tags: string[] = [];
    const combined = text + headword + collocate;

    if (ACADEMIC_WORDS.some(w => combined.includes(w))) tags.push("学術");
    if (combined.includes("言語") || combined.includes("文法") ||
        combined.includes("語彙") || combined.includes("品詞") ||
        combined.includes("テンス") || combined.includes("アスペクト")) {
      if (!tags.includes("学術")) tags.push("学術");
      tags.push("言語学");
    }
    if (BODY_WORDS.some(w => combined.includes(w))) tags.push("身体");
    if (EMOTION_WORDS.some(w => combined.includes(w))) tags.push("感情");
    if (SLANG_WORDS.some(w => combined.includes(w)) && !tags.includes("俗語")) tags.push("俗語");
    if (DIALECT_MARKERS.some(w => combined.includes(w)) && !tags.includes("方言")) tags.push("方言");
    // Metaphorical usage: 炎上 alone is a well-known internet term worth tagging
    if (combined.includes("炎上") || (combined.includes("消す") && combined.includes("炎"))) {
      tags.push("比喩");
    }
    // Everyday expressions (default if no other domain found)
    if (tags.length === 0) tags.push("日常");

    return tags;
  }

  // ---------------------------------------------------------------------------
  // Normalisation (spoken → written)
  // ---------------------------------------------------------------------------

  private normalise(text: string): string {
    let result = text;
    for (const [pattern, replacement] of COLLOQUIAL_FORMS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Frequency scoring
  // ---------------------------------------------------------------------------

  private scoreFrequency(text: string, tags: string[], pattern: string): number {
    let score = 50;
    if (tags.includes("俗語")) score = 45;
    if (tags.includes("日常")) score = 65;
    if (tags.includes("学術")) score = 60;
    if (tags.includes("言語学")) score = 55;
    if (pattern === "N+する") score = Math.max(score, 70);
    if (pattern.includes("passive")) score = Math.max(score, 60);
    // Boost for common short patterns
    if (text.length <= 6) score = Math.min(score + 10, 95);
    return Math.min(Math.max(score, 20), 100);
  }
}
