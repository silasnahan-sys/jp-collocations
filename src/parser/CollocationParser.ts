/**
 * CollocationParser: extracts collocation candidates from free text.
 * Zero-Obsidian — safe to use in any non-plugin context.
 */

export interface ParsedCollocation {
  headword: string;
  collocate: string;
  fullPhrase: string;
  pattern: string;
}

/** Very lightweight: detect Noun+Verb, Noun+Adjective, Verb+Noun patterns. */
const COLLOCATION_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "N+V",    regex: /([^\s。、！？]{1,8})(を|が|に|で|と)([^\s。、！？]{1,8}[うくぐすつぬぶむる])/ },
  { name: "N+Adj",  regex: /([^\s。、！？]{1,8})(が|は|も)([^\s。、！？]{1,8}[いかった])/ },
  { name: "V+N",    regex: /([^\s。、！？]{1,8}[てでいき])([^\s。、！？]{1,8}[名詞])/ },
  { name: "A+N",    regex: /([^\s。、！？]{1,8}[いなな])([^\s。、！？]{1,8})/ },
];

export class CollocationParser {
  /**
   * Parse free Japanese text and return a list of candidate collocation pairs.
   */
  parse(text: string): ParsedCollocation[] {
    const results: ParsedCollocation[] = [];
    const seen = new Set<string>();

    for (const { name, regex } of COLLOCATION_PATTERNS) {
      let match: RegExpExecArray | null;
      const re = new RegExp(regex.source, "g");
      while ((match = re.exec(text)) !== null) {
        const headword = match[1];
        const collocate = match[match.length - 1];
        const fullPhrase = match[0];
        const key = `${headword}:${collocate}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ headword, collocate, fullPhrase, pattern: name });
        }
      }
    }

    return results;
  }

  /** Extract all discourse bits from text marked with ||. */
  extractBits(text: string): string[] {
    return text
      .split("||")
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }
}
