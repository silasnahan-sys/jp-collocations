import type { CollocationEntry } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import type { CollocationSpan } from "./SurferBridge.ts";
import { CollocationStrength } from "../types.ts";

// Simple hash function for caching
function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

// Minimal trie node
interface TrieNode {
  children: Map<string, TrieNode>;
  entryIds: string[];
}

function newNode(): TrieNode {
  return { children: new Map(), entryIds: [] };
}

// Verb stem extraction — handles common conjugation endings
function extractStem(word: string): string {
  const ichidan = ["る"];
  const godan = ["う", "く", "ぐ", "す", "つ", "ぬ", "ぶ", "む", "る"];
  const conjugated: Record<string, string> = {
    // て形 / た形 variants
    "って": "う", "いて": "く", "いで": "ぐ", "して": "す", "って": "つ",
    "んで": "ぬ", "んで": "ぶ", "んで": "む", "て": "る",
    // ない形
    "わない": "う", "かない": "く", "がない": "ぐ", "さない": "す",
    "たない": "つ", "なない": "ぬ", "ばない": "ぶ", "まない": "む",
    "らない": "る", "ない": "る",
    // ます形
    "います": "う", "きます": "く", "ぎます": "ぐ", "します": "す",
    "ちます": "つ", "にます": "ぬ", "びます": "ぶ", "みます": "む",
    "ります": "る", "ます": "る",
    // た形
    "った": "う", "いた": "く", "いだ": "ぐ", "した": "す", "った": "つ",
    "んだ": "ぬ", "んだ": "ぶ", "んだ": "む", "た": "る",
  };

  for (const [suffix, base] of Object.entries(conjugated)) {
    if (word.endsWith(suffix) && word.length > suffix.length) {
      return word.slice(0, word.length - suffix.length) + base;
    }
  }
  return word;
}

// Tokenize Japanese text into character-level segments
// This is a simple character-based tokenizer that splits on word boundaries
function tokenize(text: string): Array<{ token: string; start: number; end: number }> {
  const tokens: Array<{ token: string; start: number; end: number }> = [];
  // Split into chunks: CJK runs, kana runs, latin runs, number runs, punctuation
  const re = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]+|[a-zA-Z0-9]+|[^\s]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ token: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

// Split a CJK run into individual characters for constituent matching
function splitCJK(text: string, startOffset: number): Array<{ token: string; start: number; end: number }> {
  const result: Array<{ token: string; start: number; end: number }> = [];
  for (let i = 0; i < text.length; i++) {
    result.push({ token: text[i], start: startOffset + i, end: startOffset + i + 1 });
  }
  return result;
}

export class CollocationScanner {
  private store: CollocationStore;
  private trie: TrieNode = newNode();
  private phraseMap: Map<string, string[]> = new Map(); // fullPhrase → entryIds
  private headwordCollocateMap: Map<string, string[]> = new Map(); // headword+collocate → entryIds
  private cache: Map<string, CollocationSpan[]> = new Map();
  private cacheMaxSize = 50;
  private indexBuilt = false;
  private changeListener: () => void;

  constructor(store: CollocationStore) {
    this.store = store;
    this.changeListener = () => {
      this.invalidateCache();
      this.buildIndex();
    };
    this.store.onStoreChange(this.changeListener);
  }

  destroy(): void {
    this.store.offStoreChange(this.changeListener);
  }

  buildIndex(): void {
    this.trie = newNode();
    this.phraseMap = new Map();
    this.headwordCollocateMap = new Map();

    for (const entry of this.store.getAll()) {
      // Index by fullPhrase
      this.addPhraseToIndex(entry.fullPhrase, entry.id);

      // Index by headword+collocate concatenation
      const combined = entry.headword + entry.collocate;
      this.addPhraseToIndex(combined, entry.id);
      const hcKey = entry.headword + "\0" + entry.collocate;
      if (!this.headwordCollocateMap.has(hcKey)) this.headwordCollocateMap.set(hcKey, []);
      this.headwordCollocateMap.get(hcKey)!.push(entry.id);

      // Index constituent tokens via trie
      if (entry.constituentTokens && entry.constituentTokens.length > 0) {
        this.insertIntoTrie(entry.constituentTokens, entry.id);
      } else {
        // Fall back: use individual characters of fullPhrase as constituent tokens
        const chars = entry.fullPhrase.split("").filter(c => c.trim());
        if (chars.length > 0) this.insertIntoTrie(chars, entry.id);
      }
    }

    this.indexBuilt = true;
  }

  private addPhraseToIndex(phrase: string, entryId: string): void {
    const key = phrase.replace(/\s/g, "");
    if (!this.phraseMap.has(key)) this.phraseMap.set(key, []);
    const arr = this.phraseMap.get(key)!;
    if (!arr.includes(entryId)) arr.push(entryId);
  }

  private insertIntoTrie(tokens: string[], entryId: string): void {
    let node = this.trie;
    for (const token of tokens) {
      if (!node.children.has(token)) {
        node.children.set(token, newNode());
      }
      node = node.children.get(token)!;
    }
    if (!node.entryIds.includes(entryId)) {
      node.entryIds.push(entryId);
    }
  }

  invalidateCache(): void {
    this.cache.clear();
  }

  scan(text: string): CollocationSpan[] {
    if (!this.indexBuilt) this.buildIndex();

    const cacheKey = hashText(text);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const spans = this.doScan(text);

    // Manage cache size
    if (this.cache.size >= this.cacheMaxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(cacheKey, spans);
    return spans;
  }

  private doScan(text: string): CollocationSpan[] {
    const results: CollocationSpan[] = [];
    const cleanText = text;

    // Strategy 1: Direct phrase lookup (fastest)
    const phraseMatches = this.scanByPhrase(cleanText);
    for (const m of phraseMatches) results.push(m);

    // Strategy 2: Trie-based constituent token matching
    const trieMatches = this.scanByTrie(cleanText);
    for (const m of trieMatches) {
      // Only add if not already covered
      if (!results.some(r => r.entryId === m.entryId && r.start === m.start)) {
        results.push(m);
      }
    }

    // Deduplicate by entryId+start
    const seen = new Set<string>();
    const deduped: CollocationSpan[] = [];
    for (const span of results) {
      const key = `${span.entryId}:${span.start}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(span);
      }
    }

    return deduped.sort((a, b) => a.start - b.start);
  }

  private scanByPhrase(text: string): CollocationSpan[] {
    const results: CollocationSpan[] = [];
    for (const [phrase, entryIds] of this.phraseMap) {
      if (!phrase) continue;
      let searchFrom = 0;
      while (searchFrom < text.length) {
        const idx = text.indexOf(phrase, searchFrom);
        if (idx === -1) break;
        for (const entryId of entryIds) {
          const entry = this.store.getById(entryId);
          if (!entry) continue;
          results.push(this.makeSpan(entry, idx, idx + phrase.length));
        }
        searchFrom = idx + 1;
      }
    }
    return results;
  }

  private scanByTrie(text: string): CollocationSpan[] {
    const results: CollocationSpan[] = [];
    // Tokenize text at character level for CJK
    const rawTokens = tokenize(text);
    // Expand CJK runs into individual chars
    const tokens: Array<{ token: string; start: number; end: number }> = [];
    for (const t of rawTokens) {
      if (/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(t.token) && t.token.length > 1) {
        for (const ch of splitCJK(t.token, t.start)) tokens.push(ch);
      } else {
        tokens.push(t);
      }
    }

    // Slide window using trie
    for (let i = 0; i < tokens.length; i++) {
      let node = this.trie;
      let j = i;
      while (j < tokens.length) {
        const tok = tokens[j].token;
        // Try exact match
        if (node.children.has(tok)) {
          node = node.children.get(tok)!;
        } else {
          // Try stem variant
          const stem = extractStem(tok);
          if (stem !== tok && node.children.has(stem)) {
            node = node.children.get(stem)!;
          } else {
            break;
          }
        }
        if (node.entryIds.length > 0) {
          const spanStart = tokens[i].start;
          const spanEnd = tokens[j].end;
          for (const entryId of node.entryIds) {
            const entry = this.store.getById(entryId);
            if (!entry) continue;
            results.push(this.makeSpan(entry, spanStart, spanEnd));
          }
        }
        j++;
      }
    }

    return results;
  }

  private makeSpan(entry: CollocationEntry, start: number, end: number): CollocationSpan {
    return {
      entryId: entry.id,
      start,
      end,
      fullPhrase: entry.fullPhrase,
      headword: entry.headword,
      pattern: entry.pattern,
      strength: entry.strength ?? CollocationStrength.Moderate,
      register: entry.register,
      jlptLevel: entry.jlptLevel,
      boundaryType: entry.boundaryType,
    };
  }

  incrementalScan(text: string, editOffset: number, editLength: number): CollocationSpan[] {
    // For now: full re-scan with cache bust for affected region
    const cacheKey = hashText(text);
    this.cache.delete(cacheKey);
    return this.scan(text);
  }

  setCacheSize(size: number): void {
    this.cacheMaxSize = size;
    while (this.cache.size > this.cacheMaxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
  }
}
