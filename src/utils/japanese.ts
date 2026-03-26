/**
 * Japanese text utilities: kana conversion, romaji input, detection, normalization.
 */

const HIRAGANA_START = 0x3041;
const HIRAGANA_END = 0x3096;
const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;

export function toHiragana(str: string): string {
  return str.replace(/[\u30a1-\u30f6]/g, ch => {
    return String.fromCharCode(ch.charCodeAt(0) - (KATAKANA_START - HIRAGANA_START));
  });
}

export function toKatakana(str: string): string {
  return str.replace(/[\u3041-\u3096]/g, ch => {
    return String.fromCharCode(ch.charCodeAt(0) + (KATAKANA_START - HIRAGANA_START));
  });
}

export function isHiragana(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= HIRAGANA_START && code <= HIRAGANA_END;
}

export function isKatakana(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= KATAKANA_START && code <= KATAKANA_END;
}

export function isKanji(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x4e00 && code <= 0x9faf) || (code >= 0x3400 && code <= 0x4dbf);
}

export function isJapanese(str: string): boolean {
  return /[\u3000-\u9fff\uff00-\uffef]/.test(str);
}

export function normalizeJapanese(str: string): string {
  // Normalize full-width ASCII to half-width
  str = str.replace(/[\uff01-\uff5e]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
  // Normalize full-width space
  str = str.replace(/\u3000/g, " ");
  return str.normalize("NFKC");
}

// Romaji syllable map (simplified Hepburn)
const ROMAJI_MAP: [string, string][] = [
  ["shi", "し"], ["chi", "ち"], ["tsu", "つ"], ["sha", "しゃ"], ["shu", "しゅ"],
  ["sho", "しょ"], ["cha", "ちゃ"], ["chu", "ちゅ"], ["cho", "ちょ"], ["tchi", "っち"],
  ["cchi", "っち"], ["jji", "っじ"], ["ffu", "っふ"],
  ["kya", "きゃ"], ["kyu", "きゅ"], ["kyo", "きょ"],
  ["gya", "ぎゃ"], ["gyu", "ぎゅ"], ["gyo", "ぎょ"],
  ["nya", "にゃ"], ["nyu", "にゅ"], ["nyo", "にょ"],
  ["hya", "ひゃ"], ["hyu", "ひゅ"], ["hyo", "ひょ"],
  ["mya", "みゃ"], ["myu", "みゅ"], ["myo", "みょ"],
  ["rya", "りゃ"], ["ryu", "りゅ"], ["ryo", "りょ"],
  ["bya", "びゃ"], ["byu", "びゅ"], ["byo", "びょ"],
  ["pya", "ぴゃ"], ["pyu", "ぴゅ"], ["pyo", "ぴょ"],
  ["ja", "じゃ"], ["ji", "じ"], ["ju", "じゅ"], ["jo", "じょ"],
  ["tchi", "っち"], ["tta", "った"], ["tte", "って"], ["tto", "っと"],
  ["kka", "っか"], ["kki", "っき"], ["kku", "っく"], ["kke", "っけ"], ["kko", "っこ"],
  ["ssa", "っさ"], ["ssi", "っし"], ["ssu", "っす"], ["sse", "っせ"], ["sso", "っそ"],
  ["ppa", "っぱ"], ["ppi", "っぴ"], ["ppu", "っぷ"], ["ppe", "っぺ"], ["ppo", "っぽ"],
  ["a", "あ"], ["i", "い"], ["u", "う"], ["e", "え"], ["o", "お"],
  ["ka", "か"], ["ki", "き"], ["ku", "く"], ["ke", "け"], ["ko", "こ"],
  ["sa", "さ"], ["si", "し"], ["su", "す"], ["se", "せ"], ["so", "そ"],
  ["ta", "た"], ["ti", "ち"], ["tu", "つ"], ["te", "て"], ["to", "と"],
  ["na", "な"], ["ni", "に"], ["nu", "ぬ"], ["ne", "ね"], ["no", "の"],
  ["ha", "は"], ["hi", "ひ"], ["fu", "ふ"], ["he", "へ"], ["ho", "ほ"],
  ["ma", "ま"], ["mi", "み"], ["mu", "む"], ["me", "め"], ["mo", "も"],
  ["ya", "や"], ["yu", "ゆ"], ["yo", "よ"],
  ["ra", "ら"], ["ri", "り"], ["ru", "る"], ["re", "れ"], ["ro", "ろ"],
  ["wa", "わ"], ["wi", "ゐ"], ["we", "ゑ"], ["wo", "を"],
  ["n", "ん"],
  ["ga", "が"], ["gi", "ぎ"], ["gu", "ぐ"], ["ge", "げ"], ["go", "ご"],
  ["za", "ざ"], ["zi", "じ"], ["zu", "ず"], ["ze", "ぜ"], ["zo", "ぞ"],
  ["da", "だ"], ["di", "ぢ"], ["du", "づ"], ["de", "で"], ["do", "ど"],
  ["ba", "ば"], ["bi", "び"], ["bu", "ぶ"], ["be", "べ"], ["bo", "ぼ"],
  ["pa", "ぱ"], ["pi", "ぴ"], ["pu", "ぷ"], ["pe", "ぺ"], ["po", "ぽ"],
];

export function romajiToHiragana(input: string): string {
  let result = "";
  let remaining = input.toLowerCase();
  while (remaining.length > 0) {
    let matched = false;
    // Try longest match first (up to 4 chars)
    for (let len = Math.min(4, remaining.length); len >= 1; len--) {
      const slice = remaining.slice(0, len);
      const found = ROMAJI_MAP.find(([r]) => r === slice);
      if (found) {
        result += found[1];
        remaining = remaining.slice(len);
        matched = true;
        break;
      }
    }
    if (!matched) {
      result += remaining[0];
      remaining = remaining.slice(1);
    }
  }
  return result;
}

export function getReading(str: string): string {
  // Extract hiragana/katakana substrings as a basic reading approximation
  return str.split("").filter(ch => isHiragana(ch) || isKatakana(ch)).join("");
}

export function katakanaToHiragana(str: string): string {
  return toHiragana(str);
}

/** Compute simple Levenshtein distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Normalized similarity: 1 = identical, 0 = completely different. */
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}
