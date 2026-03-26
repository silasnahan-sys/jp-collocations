import { PartOfSpeech } from "../types.ts";

/**
 * Grammar utilities: verb/adjective conjugation, search expansion, POS detection.
 */

/** Given a godan (u-verb) or ichidan (ru-verb) dictionary form, return common conjugations. */
export function getVerbForms(verb: string): string[] {
  if (!verb) return [];
  const forms: string[] = [verb];

  // Ichidan (る-verb): ends in る preceded by i/e-row kana
  const ichidanSuffixes = ["いる", "きる", "ぎる", "じる", "ちる", "にる", "びる", "みる", "りる", "える", "ける", "げる", "せる", "てる", "でる", "ねる", "べる", "める", "れる"];
  const isIchidan = ichidanSuffixes.some(s => verb.endsWith(s)) || verb.endsWith("る");

  if (isIchidan && verb.endsWith("る")) {
    const stem = verb.slice(0, -1);
    forms.push(
      stem + "ます",      // polite
      stem + "ない",      // negative
      stem + "て",        // te-form
      stem + "た",        // ta-form (past)
      stem + "れる",      // passive
      stem + "られる",    // potential/passive
      stem + "よう",      // volitional
      stem + "ば",        // conditional
    );
  }

  // Godan consonant-stem verbs — map ending kana to row
  const godanMap: Record<string, { masu: string; nai: string; te: string; ta: string; ba: string }> = {
    "う": { masu: "い", nai: "わ", te: "って", ta: "った", ba: "えば" },
    "く": { masu: "き", nai: "か", te: "いて", ta: "いた", ba: "けば" },
    "ぐ": { masu: "ぎ", nai: "が", te: "いで", ta: "いだ", ba: "げば" },
    "す": { masu: "し", nai: "さ", te: "して", ta: "した", ba: "せば" },
    "つ": { masu: "ち", nai: "た", te: "って", ta: "った", ba: "てば" },
    "ぬ": { masu: "に", nai: "な", te: "んで", ta: "んだ", ba: "ねば" },
    "ぶ": { masu: "び", nai: "ば", te: "んで", ta: "んだ", ba: "べば" },
    "む": { masu: "み", nai: "ま", te: "んで", ta: "んだ", ba: "めば" },
    "る": { masu: "り", nai: "ら", te: "って", ta: "った", ba: "れば" },
  };

  const lastChar = verb.slice(-1);
  const g = godanMap[lastChar];
  if (g) {
    const base = verb.slice(0, -1);
    forms.push(
      base + g.masu + "ます",
      base + g.nai + "ない",
      base + g.te,
      base + g.ta,
      base + g.ba,
    );
  }

  // Remove duplicates
  return [...new Set(forms)];
}

/** Given an い-adjective, return common conjugated forms. */
export function getAdjectiveForms(adj: string): string[] {
  if (!adj || !adj.endsWith("い")) return [adj];
  const stem = adj.slice(0, -1);
  return [
    adj,
    stem + "く",         // adverbial / negative base
    stem + "くて",       // te-form
    stem + "くない",     // negative
    stem + "かった",     // past
    stem + "くなかった", // past negative
    stem + "ければ",     // conditional
  ];
}

/** Given a な-adjective (without な), return forms. */
export function getNaAdjectiveForms(adj: string): string[] {
  return [
    adj,
    adj + "な",
    adj + "に",
    adj + "で",
    adj + "だ",
    adj + "だった",
    adj + "ではない",
    adj + "でない",
    adj + "なら",
  ];
}

/** Expand a search query to include grammar variations. */
export function expandSearch(query: string): string[] {
  const expanded = new Set<string>([query]);

  // If ends in い, could be i-adjective
  if (query.endsWith("い")) {
    for (const f of getAdjectiveForms(query)) expanded.add(f);
  }

  // If ends in a verb-final kana
  const verbEndings = ["う", "く", "ぐ", "す", "つ", "ぬ", "ぶ", "む", "る"];
  if (verbEndings.some(e => query.endsWith(e))) {
    for (const f of getVerbForms(query)) expanded.add(f);
  }

  return [...expanded];
}

/** Basic POS detection heuristic. */
export function detectPOS(word: string): PartOfSpeech {
  if (!word) return PartOfSpeech.Other;

  // Verb endings (godan/ichidan)
  if (/[うくぐすつぬぶむる]$/.test(word)) {
    // Extra check: common i-adjective ending う like "きれい" shouldn't be verb
    if (word.endsWith("い") && !word.endsWith("るい")) {
      return PartOfSpeech.Adjective_i;
    }
    return PartOfSpeech.Verb;
  }

  // い-adjective
  if (word.endsWith("い")) return PartOfSpeech.Adjective_i;

  // な-adjective indicators (this is weak heuristic)
  const naAdj = ["的", "的な", "な"];
  if (naAdj.some(s => word.endsWith(s))) return PartOfSpeech.Adjective_na;

  // Adverbs often end in に or く
  if (word.endsWith("に") || word.endsWith("と")) return PartOfSpeech.Adverb;

  // Default to noun
  return PartOfSpeech.Noun;
}
