import type { DiscourseCategory, DiscoursePosition } from '../surfer-types.ts';

// ── Exported types ──────────────────────────────────────────────────────────

export type GranularityLevel =
  | 'morpheme'
  | 'bunsetsu'
  | 'clause'
  | 'utterance'
  | 'turn'
  | 'exchange'
  | 'episode';

export interface PhraseAnalysis {
  headword: string;
  headwordReading: string;
  collocate: string;
  collocateReading: string;
  pattern: string;
  headwordPOS: string;
  collocatePOS: string;
  confidence: number;
  notes: string[];
}

export interface TextSegment {
  text: string;
  granularity: GranularityLevel;
  startOffset: number;
  endOffset: number;
  discourseCategory?: DiscourseCategory;
  discoursePosition?: DiscoursePosition;
  pragmaticFunction?: string;
}

export interface DiscourseMarkerHit {
  surface: string;
  reading: string;
  category: DiscourseCategory;
  position: DiscoursePosition;
  pragmaticFunction: string;
  startOffset: number;
  endOffset: number;
  granularity: GranularityLevel;
}

export interface CollocationParseResult {
  originalText: string;
  segments: TextSegment[];
  discourseMarkers: DiscourseMarkerHit[];
  phraseAnalyses: PhraseAnalysis[];
  primaryCategory: DiscourseCategory | null;
  primaryPosition: DiscoursePosition;
  granularity: GranularityLevel;
  confidence: number;
}

// ── Internal marker definition ──────────────────────────────────────────────

interface MarkerDef {
  surface: string;
  reading: string;
  category: DiscourseCategory;
  position: DiscoursePosition;
  pragmaticFunction: string;
  granularity: GranularityLevel;
}

// ── CollocationParser ───────────────────────────────────────────────────────

export class CollocationParser {
  // 80 markers — 10 per category
  private readonly DISCOURSE_MARKERS: readonly MarkerDef[] = [
    // ── topic-initiation ──
    { surface: '話は変わりますが', reading: 'hanashi wa kawarimasu ga', category: 'topic-initiation', position: 'utterance-initial', pragmaticFunction: 'signals topic shift', granularity: 'utterance' },
    { surface: 'ところで', reading: 'tokorode', category: 'topic-initiation', position: 'utterance-initial', pragmaticFunction: 'introduces new topic', granularity: 'utterance' },
    { surface: 'さて', reading: 'sate', category: 'topic-initiation', position: 'utterance-initial', pragmaticFunction: 'transitions to new topic', granularity: 'utterance' },
    { surface: 'そういえば', reading: 'sō ieba', category: 'topic-initiation', position: 'utterance-initial', pragmaticFunction: 'recalls related topic', granularity: 'utterance' },
    { surface: '実は', reading: 'jitsu wa', category: 'topic-initiation', position: 'utterance-initial', pragmaticFunction: 'introduces surprising information', granularity: 'utterance' },
    { surface: '話題を変えて', reading: 'wadai o kaete', category: 'topic-initiation', position: 'utterance-initial', pragmaticFunction: 'explicitly changes topic', granularity: 'utterance' },
    { surface: 'まず', reading: 'mazu', category: 'topic-initiation', position: 'utterance-initial', pragmaticFunction: 'introduces first point', granularity: 'clause' },
    { surface: 'はじめに', reading: 'hajime ni', category: 'topic-initiation', position: 'utterance-initial', pragmaticFunction: 'introduces opening topic', granularity: 'utterance' },
    { surface: '最初に', reading: 'saisho ni', category: 'topic-initiation', position: 'utterance-initial', pragmaticFunction: 'introduces first item', granularity: 'clause' },
    { surface: '一つ目に', reading: 'hitotsu-me ni', category: 'topic-initiation', position: 'utterance-initial', pragmaticFunction: 'enumerates first point', granularity: 'clause' },

    // ── reasoning ──
    { surface: 'だから', reading: 'dakara', category: 'reasoning', position: 'utterance-initial', pragmaticFunction: 'states consequence', granularity: 'clause' },
    { surface: 'したがって', reading: 'shitaga-tte', category: 'reasoning', position: 'utterance-initial', pragmaticFunction: 'draws logical conclusion', granularity: 'clause' },
    { surface: 'そのため', reading: 'sono tame', category: 'reasoning', position: 'utterance-initial', pragmaticFunction: 'provides reason', granularity: 'clause' },
    { surface: 'ので', reading: 'node', category: 'reasoning', position: 'mid-utterance', pragmaticFunction: 'indicates cause', granularity: 'clause' },
    { surface: 'から', reading: 'kara', category: 'reasoning', position: 'mid-utterance', pragmaticFunction: 'marks reason', granularity: 'morpheme' },
    { surface: 'なぜなら', reading: 'nazenara', category: 'reasoning', position: 'utterance-initial', pragmaticFunction: 'introduces explanation', granularity: 'clause' },
    { surface: 'というのは', reading: 'to iu no wa', category: 'reasoning', position: 'mid-utterance', pragmaticFunction: 'elaborates reason', granularity: 'clause' },
    { surface: '結果として', reading: 'kekka to shite', category: 'reasoning', position: 'utterance-initial', pragmaticFunction: 'summarises result', granularity: 'clause' },
    { surface: '以上のことから', reading: 'ijō no koto kara', category: 'reasoning', position: 'utterance-initial', pragmaticFunction: 'draws conclusion from evidence', granularity: 'utterance' },
    { surface: 'よって', reading: 'yotte', category: 'reasoning', position: 'utterance-initial', pragmaticFunction: 'states formal conclusion', granularity: 'clause' },

    // ── modality ──
    { surface: 'かもしれない', reading: 'kamoshirenai', category: 'modality', position: 'utterance-final', pragmaticFunction: 'expresses possibility', granularity: 'clause' },
    { surface: 'はずだ', reading: 'hazu da', category: 'modality', position: 'utterance-final', pragmaticFunction: 'expresses expectation', granularity: 'clause' },
    { surface: 'べきだ', reading: 'beki da', category: 'modality', position: 'utterance-final', pragmaticFunction: 'expresses obligation', granularity: 'clause' },
    { surface: 'らしい', reading: 'rashii', category: 'modality', position: 'utterance-final', pragmaticFunction: 'expresses hearsay', granularity: 'clause' },
    { surface: 'ようだ', reading: 'yō da', category: 'modality', position: 'utterance-final', pragmaticFunction: 'expresses appearance', granularity: 'clause' },
    { surface: 'だろう', reading: 'darō', category: 'modality', position: 'utterance-final', pragmaticFunction: 'expresses conjecture', granularity: 'clause' },
    { surface: 'に違いない', reading: 'ni chigainai', category: 'modality', position: 'utterance-final', pragmaticFunction: 'expresses certainty', granularity: 'clause' },
    { surface: 'わけだ', reading: 'wake da', category: 'modality', position: 'utterance-final', pragmaticFunction: 'explains reason/conclusion', granularity: 'clause' },
    { surface: 'ことになっている', reading: 'koto ni natte iru', category: 'modality', position: 'utterance-final', pragmaticFunction: 'expresses institutional expectation', granularity: 'clause' },
    { surface: 'ざるを得ない', reading: 'zaru o enai', category: 'modality', position: 'utterance-final', pragmaticFunction: 'expresses unavoidability', granularity: 'clause' },

    // ── connective ──
    { surface: 'しかし', reading: 'shikashi', category: 'connective', position: 'utterance-initial', pragmaticFunction: 'introduces contrast', granularity: 'clause' },
    { surface: 'でも', reading: 'demo', category: 'connective', position: 'utterance-initial', pragmaticFunction: 'introduces informal contrast', granularity: 'clause' },
    { surface: 'ただし', reading: 'tadashi', category: 'connective', position: 'utterance-initial', pragmaticFunction: 'adds proviso', granularity: 'clause' },
    { surface: 'とはいえ', reading: 'to wa ie', category: 'connective', position: 'utterance-initial', pragmaticFunction: 'concedes then contrasts', granularity: 'clause' },
    { surface: 'それでも', reading: 'soredemo', category: 'connective', position: 'utterance-initial', pragmaticFunction: 'persists despite contrast', granularity: 'clause' },
    { surface: 'にもかかわらず', reading: 'ni mo kakawarazu', category: 'connective', position: 'mid-utterance', pragmaticFunction: 'indicates concession', granularity: 'clause' },
    { surface: 'その上', reading: 'sono ue', category: 'connective', position: 'utterance-initial', pragmaticFunction: 'adds information', granularity: 'clause' },
    { surface: 'さらに', reading: 'sara ni', category: 'connective', position: 'utterance-initial', pragmaticFunction: 'adds further information', granularity: 'clause' },
    { surface: 'また', reading: 'mata', category: 'connective', position: 'utterance-initial', pragmaticFunction: 'introduces additional point', granularity: 'clause' },
    { surface: 'そして', reading: 'soshite', category: 'connective', position: 'utterance-initial', pragmaticFunction: 'links sequential events', granularity: 'clause' },

    // ── confirmation ──
    { surface: 'ね', reading: 'ne', category: 'confirmation', position: 'utterance-final', pragmaticFunction: 'seeks agreement', granularity: 'morpheme' },
    { surface: 'よね', reading: 'yone', category: 'confirmation', position: 'utterance-final', pragmaticFunction: 'seeks confirmation with assertion', granularity: 'morpheme' },
    { surface: 'でしょう', reading: 'deshō', category: 'confirmation', position: 'utterance-final', pragmaticFunction: 'seeks polite confirmation', granularity: 'clause' },
    { surface: 'そうですね', reading: 'sō desu ne', category: 'confirmation', position: 'utterance-initial', pragmaticFunction: 'expresses agreement', granularity: 'utterance' },
    { surface: '確かに', reading: 'tashika ni', category: 'confirmation', position: 'utterance-initial', pragmaticFunction: 'acknowledges certainty', granularity: 'clause' },
    { surface: 'なるほど', reading: 'naruhodo', category: 'confirmation', position: 'utterance-initial', pragmaticFunction: 'expresses understanding', granularity: 'utterance' },
    { surface: 'そうか', reading: 'sō ka', category: 'confirmation', position: 'utterance-initial', pragmaticFunction: 'acknowledges new information', granularity: 'utterance' },
    { surface: 'ですよね', reading: 'desu yo ne', category: 'confirmation', position: 'utterance-final', pragmaticFunction: 'seeks strong confirmation', granularity: 'clause' },
    { surface: 'じゃないですか', reading: 'ja nai desu ka', category: 'confirmation', position: 'utterance-final', pragmaticFunction: 'rhetorical confirmation', granularity: 'clause' },
    { surface: 'わかった', reading: 'wakatta', category: 'confirmation', position: 'utterance-initial', pragmaticFunction: 'confirms understanding', granularity: 'utterance' },

    // ── rephrasing ──
    { surface: 'つまり', reading: 'tsumari', category: 'rephrasing', position: 'utterance-initial', pragmaticFunction: 'summarises / rephrases', granularity: 'clause' },
    { surface: '言い換えれば', reading: 'iikaereba', category: 'rephrasing', position: 'utterance-initial', pragmaticFunction: 'explicitly rephrases', granularity: 'clause' },
    { surface: 'すなわち', reading: 'sunawachi', category: 'rephrasing', position: 'utterance-initial', pragmaticFunction: 'formal equivalence marker', granularity: 'clause' },
    { surface: '要するに', reading: 'yō suru ni', category: 'rephrasing', position: 'utterance-initial', pragmaticFunction: 'boils down to essentials', granularity: 'clause' },
    { surface: '別の言い方をすると', reading: 'betsu no iikata o suru to', category: 'rephrasing', position: 'utterance-initial', pragmaticFunction: 'offers alternative phrasing', granularity: 'utterance' },
    { surface: '換言すれば', reading: 'kangen sureba', category: 'rephrasing', position: 'utterance-initial', pragmaticFunction: 'formal rephrasing', granularity: 'clause' },
    { surface: '一言で言えば', reading: 'hitokoto de ieba', category: 'rephrasing', position: 'utterance-initial', pragmaticFunction: 'condenses to one phrase', granularity: 'utterance' },
    { surface: '平たく言うと', reading: 'hirataku iu to', category: 'rephrasing', position: 'utterance-initial', pragmaticFunction: 'simplifies expression', granularity: 'utterance' },
    { surface: '簡単に言えば', reading: 'kantan ni ieba', category: 'rephrasing', position: 'utterance-initial', pragmaticFunction: 'simplifies to basics', granularity: 'clause' },
    { surface: '具体的に言うと', reading: 'gutaiteki ni iu to', category: 'rephrasing', position: 'utterance-initial', pragmaticFunction: 'makes concrete', granularity: 'utterance' },

    // ── filler ──
    { surface: 'えーと', reading: 'ēto', category: 'filler', position: 'utterance-initial', pragmaticFunction: 'hesitation / floor-holding', granularity: 'morpheme' },
    { surface: 'あの', reading: 'ano', category: 'filler', position: 'utterance-initial', pragmaticFunction: 'attention-getting hesitation', granularity: 'morpheme' },
    { surface: 'うーん', reading: 'ūn', category: 'filler', position: 'utterance-initial', pragmaticFunction: 'deliberation', granularity: 'morpheme' },
    { surface: 'まあ', reading: 'mā', category: 'filler', position: 'utterance-initial', pragmaticFunction: 'hedging / softening', granularity: 'morpheme' },
    { surface: 'ちょっと待って', reading: 'chotto matte', category: 'filler', position: 'utterance-initial', pragmaticFunction: 'requests pause', granularity: 'utterance' },
    { surface: 'そうですね...', reading: 'sō desu ne...', category: 'filler', position: 'utterance-initial', pragmaticFunction: 'thinking aloud', granularity: 'utterance' },
    { surface: 'なんか', reading: 'nanka', category: 'filler', position: 'mid-utterance', pragmaticFunction: 'vague filler / softener', granularity: 'morpheme' },
    { surface: 'どうも', reading: 'dōmo', category: 'filler', position: 'utterance-initial', pragmaticFunction: 'vague greeting or hedge', granularity: 'morpheme' },
    { surface: 'それで', reading: 'sorede', category: 'filler', position: 'utterance-initial', pragmaticFunction: 'prompts continuation', granularity: 'clause' },
    { surface: 'ねえ', reading: 'nē', category: 'filler', position: 'utterance-initial', pragmaticFunction: 'attention-getting', granularity: 'morpheme' },

    // ── quotation ──
    { surface: 'と言っていた', reading: 'to itte ita', category: 'quotation', position: 'utterance-final', pragmaticFunction: 'reports past speech', granularity: 'clause' },
    { surface: 'によると', reading: 'ni yoru to', category: 'quotation', position: 'mid-utterance', pragmaticFunction: 'attributes source', granularity: 'clause' },
    { surface: 'らしくて', reading: 'rashikute', category: 'quotation', position: 'mid-utterance', pragmaticFunction: 'reports hearsay with continuation', granularity: 'clause' },
    { surface: 'そうで', reading: 'sō de', category: 'quotation', position: 'mid-utterance', pragmaticFunction: 'conveys reported information', granularity: 'clause' },
    { surface: 'と聞いた', reading: 'to kiita', category: 'quotation', position: 'utterance-final', pragmaticFunction: 'reports heard information', granularity: 'clause' },
    { surface: 'と言われている', reading: 'to iwarete iru', category: 'quotation', position: 'utterance-final', pragmaticFunction: 'reports common saying', granularity: 'clause' },
    { surface: 'によれば', reading: 'ni yoreba', category: 'quotation', position: 'mid-utterance', pragmaticFunction: 'attributes formal source', granularity: 'clause' },
    { surface: '曰く', reading: 'iwaku', category: 'quotation', position: 'mid-utterance', pragmaticFunction: 'classical quotation marker', granularity: 'clause' },
    { surface: 'いわゆる', reading: 'iwayuru', category: 'quotation', position: 'mid-utterance', pragmaticFunction: 'marks so-called expression', granularity: 'bunsetsu' },
    { surface: 'とのことだ', reading: 'to no koto da', category: 'quotation', position: 'utterance-final', pragmaticFunction: 'reports information formally', granularity: 'clause' },
  ] as const;

  // Sort markers longest-first so greedy matching works correctly
  private readonly sortedMarkers: MarkerDef[];

  constructor() {
    this.sortedMarkers = [...this.DISCOURSE_MARKERS].sort(
      (a, b) => b.surface.length - a.surface.length,
    );
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Full pipeline: segment → detect markers → analyse phrases → infer category/position/granularity */
  parse(text: string): CollocationParseResult {
    const segments = this.segmentText(text, 'bunsetsu');
    const discourseMarkers = this.detectDiscourseMarkers(text);
    const phraseAnalyses = segments.map((s) => this.parsePhrase(s.text));
    const primaryCategory = this.inferDiscourseCategory(text);
    const primaryPosition = this.inferDiscoursePosition(text);
    const granularity = this.inferGranularity(text);

    // Annotate segments with discourse info from overlapping markers
    for (const seg of segments) {
      for (const m of discourseMarkers) {
        if (m.startOffset < seg.endOffset && m.endOffset > seg.startOffset) {
          seg.discourseCategory = m.category;
          seg.discoursePosition = m.position;
          seg.pragmaticFunction = m.pragmaticFunction;
          break;
        }
      }
    }

    const confidence = this.computeOverallConfidence(discourseMarkers, phraseAnalyses, text);

    return {
      originalText: text,
      segments,
      discourseMarkers,
      phraseAnalyses,
      primaryCategory,
      primaryPosition,
      granularity,
      confidence,
    };
  }

  /** Break a single phrase into headword + collocate + pattern using Japanese morphological heuristics */
  parsePhrase(phrase: string): PhraseAnalysis {
    const trimmed = phrase.trim();
    if (trimmed.length === 0) {
      return this.emptyAnalysis();
    }

    let headword = '';
    let collocate = '';
    let pattern = '';
    let headwordPOS = 'Noun';
    let collocatePOS = 'Noun';
    let confidence = 40;
    const notes: string[] = [];

    // Length bonus
    if (trimmed.length > 2) {
      confidence += 10;
    }

    // する-verb compound: e.g. 勉強する
    const suruMatch = trimmed.match(/^(.+)(する)$/);
    if (suruMatch) {
      headword = suruMatch[1];
      collocate = suruMatch[2];
      pattern = 'N+する';
      headwordPOS = 'Noun';
      collocatePOS = 'Verb';
      confidence += 40;
      notes.push('する-verb compound detected');
      return this.buildAnalysis(headword, collocate, pattern, headwordPOS, collocatePOS, confidence, notes);
    }

    // Particle patterns: が/は + verb
    const gaHaMatch = trimmed.match(/^(.+?)(が|は)(.+)$/);
    if (gaHaMatch && this.looksLikeVerb(gaHaMatch[3])) {
      headword = gaHaMatch[1];
      collocate = gaHaMatch[3];
      pattern = `N+${gaHaMatch[2]}+V`;
      headwordPOS = 'Noun';
      collocatePOS = 'Verb';
      confidence += 40;
      notes.push(`Subject particle ${gaHaMatch[2]} + verb pattern`);
      return this.buildAnalysis(headword, collocate, pattern, headwordPOS, collocatePOS, confidence, notes);
    }

    // を + verb
    const woMatch = trimmed.match(/^(.+?)を(.+)$/);
    if (woMatch && this.looksLikeVerb(woMatch[2])) {
      headword = woMatch[1];
      collocate = woMatch[2];
      pattern = 'N+を+V';
      headwordPOS = 'Noun';
      collocatePOS = 'Verb';
      confidence += 40;
      notes.push('Object particle を + verb pattern');
      return this.buildAnalysis(headword, collocate, pattern, headwordPOS, collocatePOS, confidence, notes);
    }

    // に + verb (direction / goal)
    const niMatch = trimmed.match(/^(.+?)に(.+)$/);
    if (niMatch && this.looksLikeVerb(niMatch[2])) {
      headword = niMatch[1];
      collocate = niMatch[2];
      pattern = 'N+に+V';
      headwordPOS = 'Noun';
      collocatePOS = 'Verb';
      confidence += 40;
      notes.push('Direction/goal particle に + verb pattern');
      return this.buildAnalysis(headword, collocate, pattern, headwordPOS, collocatePOS, confidence, notes);
    }

    // で + verb
    const deMatch = trimmed.match(/^(.+?)で(.+)$/);
    if (deMatch && this.looksLikeVerb(deMatch[2])) {
      headword = deMatch[1];
      collocate = deMatch[2];
      pattern = 'N+で+V';
      headwordPOS = 'Noun';
      collocatePOS = 'Verb';
      confidence += 40;
      notes.push('Location/means particle で + verb pattern');
      return this.buildAnalysis(headword, collocate, pattern, headwordPOS, collocatePOS, confidence, notes);
    }

    // な-adjective + noun: e.g. 静かな部屋
    const naAdjMatch = trimmed.match(/^(.+?)な(.+)$/);
    if (naAdjMatch && naAdjMatch[2].length > 0) {
      headword = naAdjMatch[2];
      collocate = naAdjMatch[1];
      pattern = 'Adj-na+N';
      headwordPOS = 'Noun';
      collocatePOS = 'Adj-na';
      confidence += 40;
      notes.push('な-adjective + noun pattern');
      return this.buildAnalysis(headword, collocate, pattern, headwordPOS, collocatePOS, confidence, notes);
    }

    // の-compound: e.g. 日本の文化
    const noMatch = trimmed.match(/^(.+?)の(.+)$/);
    if (noMatch && noMatch[2].length > 0) {
      headword = noMatch[2];
      collocate = noMatch[1];
      pattern = 'N+の+N';
      headwordPOS = 'Noun';
      collocatePOS = 'Noun';
      confidence += 30;
      notes.push('の-compound (genitive/associative) pattern');
      return this.buildAnalysis(headword, collocate, pattern, headwordPOS, collocatePOS, confidence, notes);
    }

    // Ends with い → い-adjective (standalone)
    if (trimmed.match(/[^で]い$/) && trimmed.length >= 2) {
      headword = trimmed;
      collocate = '';
      pattern = 'Adj-i';
      headwordPOS = 'Adj-i';
      collocatePOS = '';
      confidence += 20;
      notes.push('い-adjective detected');
      return this.buildAnalysis(headword, collocate, pattern, headwordPOS, collocatePOS, confidence, notes);
    }

    // Standalone verb heuristic
    if (this.looksLikeVerb(trimmed)) {
      headword = trimmed;
      collocate = '';
      pattern = 'V';
      headwordPOS = 'Verb';
      collocatePOS = '';
      confidence += 20;
      notes.push('Standalone verb detected');
      return this.buildAnalysis(headword, collocate, pattern, headwordPOS, collocatePOS, confidence, notes);
    }

    // Fallback: treat as single noun/expression
    headword = trimmed;
    collocate = '';
    pattern = 'N';
    headwordPOS = this.inferPOS(trimmed);
    collocatePOS = '';
    notes.push('No recognisable pattern; treated as single unit');
    return this.buildAnalysis(headword, collocate, pattern, headwordPOS, collocatePOS, confidence, notes);
  }

  /** Segment text at the requested granularity level */
  segmentText(text: string, granularity: GranularityLevel): TextSegment[] {
    switch (granularity) {
      case 'morpheme':
        return this.segmentMorpheme(text);
      case 'bunsetsu':
        return this.segmentBunsetsu(text);
      case 'clause':
        return this.segmentClause(text);
      case 'utterance':
        return this.segmentUtterance(text);
      case 'turn':
        return this.segmentTurn(text);
      case 'exchange':
        return this.segmentExchange(text);
      case 'episode':
        return this.segmentEpisode(text);
      default:
        return this.segmentBunsetsu(text);
    }
  }

  /** Scan text for known discourse markers */
  detectDiscourseMarkers(text: string): DiscourseMarkerHit[] {
    const hits: DiscourseMarkerHit[] = [];
    const consumed = new Set<number>(); // track character positions already matched

    for (const marker of this.sortedMarkers) {
      let searchFrom = 0;
      while (true) {
        const idx = text.indexOf(marker.surface, searchFrom);
        if (idx === -1) break;

        // Check overlap with already-consumed spans
        let overlaps = false;
        for (let i = idx; i < idx + marker.surface.length; i++) {
          if (consumed.has(i)) {
            overlaps = true;
            break;
          }
        }

        if (!overlaps) {
          for (let i = idx; i < idx + marker.surface.length; i++) {
            consumed.add(i);
          }
          hits.push({
            surface: marker.surface,
            reading: marker.reading,
            category: marker.category,
            position: marker.position,
            pragmaticFunction: marker.pragmaticFunction,
            startOffset: idx,
            endOffset: idx + marker.surface.length,
            granularity: marker.granularity,
          });
        }
        searchFrom = idx + marker.surface.length;
      }
    }

    return hits.sort((a, b) => a.startOffset - b.startOffset);
  }

  /** Return the dominant discourse category detected in the text */
  inferDiscourseCategory(text: string): DiscourseCategory | null {
    const hits = this.detectDiscourseMarkers(text);
    if (hits.length === 0) return null;

    const counts: Partial<Record<DiscourseCategory, number>> = {};
    for (const h of hits) {
      counts[h.category] = (counts[h.category] ?? 0) + 1;
    }

    let best: DiscourseCategory | null = null;
    let bestCount = 0;
    for (const [cat, n] of Object.entries(counts) as [DiscourseCategory, number][]) {
      if (n > bestCount) {
        bestCount = n;
        best = cat;
      }
    }
    return best;
  }

  /** Infer utterance-initial / utterance-final / mid-utterance / any based on where markers occur */
  inferDiscoursePosition(text: string): DiscoursePosition {
    const hits = this.detectDiscourseMarkers(text);
    if (hits.length === 0) return 'any';

    const positions = new Set(hits.map((h) => h.position));
    if (positions.size === 1) return [...positions][0];

    // If markers appear near start, bias initial; near end, bias final
    const textLen = text.length;
    if (textLen === 0) return 'any';

    let initialScore = 0;
    let finalScore = 0;

    for (const h of hits) {
      const relPos = h.startOffset / textLen;
      if (relPos < 0.33) initialScore++;
      else if (relPos > 0.66) finalScore++;
    }

    if (initialScore > finalScore) return 'utterance-initial';
    if (finalScore > initialScore) return 'utterance-final';
    return 'mid-utterance';
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private inferGranularity(text: string): GranularityLevel {
    if (text.includes('\n\n')) return 'episode';
    if (text.includes('\n')) return 'turn';
    if (/[。！？]/.test(text)) return 'utterance';
    if (/[てでたりながらばけど]/.test(text)) return 'clause';
    return 'bunsetsu';
  }

  private computeOverallConfidence(
    markers: DiscourseMarkerHit[],
    analyses: PhraseAnalysis[],
    text: string,
  ): number {
    let score = 0;
    if (markers.length > 0) score += 30;
    if (markers.length > 3) score += 20;

    const avgPhraseConf =
      analyses.length > 0
        ? analyses.reduce((s, a) => s + a.confidence, 0) / analyses.length
        : 0;
    score += avgPhraseConf * 0.4;

    if (text.length > 10) score += 10;
    return Math.min(100, Math.round(score));
  }

  private looksLikeVerb(s: string): boolean {
    if (s.length === 0) return false;
    // Dictionary form endings: う/く/ぐ/す/つ/ぬ/ぶ/む/る
    if (/[うくぐすつぬぶむる]$/.test(s)) return true;
    // masu-form, ta-form, te-form, etc.
    if (/(?:ます|ました|ません|ている|ていた|ておく|てある|た|て|ない)$/.test(s)) return true;
    return false;
  }

  private inferPOS(s: string): string {
    if (this.looksLikeVerb(s)) return 'Verb';
    if (/[^で]い$/.test(s) && s.length >= 2) return 'Adj-i';
    return 'Noun';
  }

  private emptyAnalysis(): PhraseAnalysis {
    return {
      headword: '',
      headwordReading: '',
      collocate: '',
      collocateReading: '',
      pattern: '',
      headwordPOS: '',
      collocatePOS: '',
      confidence: 0,
      notes: ['Empty input'],
    };
  }

  private buildAnalysis(
    headword: string,
    collocate: string,
    pattern: string,
    headwordPOS: string,
    collocatePOS: string,
    confidence: number,
    notes: string[],
  ): PhraseAnalysis {
    return {
      headword,
      headwordReading: '', // would require dictionary lookup
      collocate,
      collocateReading: '',
      pattern,
      headwordPOS,
      collocatePOS,
      confidence: Math.min(100, confidence),
      notes,
    };
  }

  // ── Segmenters ──────────────────────────────────────────────────────────

  private buildSegments(parts: string[], granularity: GranularityLevel, sourceText: string): TextSegment[] {
    const segments: TextSegment[] = [];
    let offset = 0;
    for (const part of parts) {
      const trimmed = part;
      if (trimmed.length === 0) {
        continue;
      }
      const startIdx = sourceText.indexOf(trimmed, offset);
      const start = startIdx >= 0 ? startIdx : offset;
      segments.push({
        text: trimmed,
        granularity,
        startOffset: start,
        endOffset: start + trimmed.length,
      });
      offset = start + trimmed.length;
    }
    return segments;
  }

  /** Morpheme: split on hiragana/katakana token boundaries (simplified regex) */
  private segmentMorpheme(text: string): TextSegment[] {
    // Split into runs of: kanji, hiragana, katakana, or other
    const tokens = text.match(/[\u4E00-\u9FFF\u3400-\u4DBF]+|[\u3040-\u309F]+|[\u30A0-\u30FF]+|[^\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF]+/g);
    return this.buildSegments(tokens ?? [], 'morpheme', text);
  }

  /** Bunsetsu: split on postpositional particle + following token boundary */
  private segmentBunsetsu(text: string): TextSegment[] {
    // Split after particles は、が、を、に、で、へ、と、から、まで、より、の when followed by non-particle content
    const parts = text.split(/((?:から|まで|より|[はがをにでへとの])(?=[^\s]))/);
    // Recombine: each particle should attach to the preceding chunk
    const merged: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (i > 0 && /^(?:から|まで|より|[はがをにでへとの])$/.test(parts[i])) {
        merged[merged.length - 1] = (merged[merged.length - 1] ?? '') + parts[i];
      } else {
        merged.push(parts[i]);
      }
    }
    return this.buildSegments(merged.filter((s) => s.length > 0), 'bunsetsu', text);
  }

  /** Clause: split on clause-final forms */
  private segmentClause(text: string): TextSegment[] {
    // Match clause-final connective forms; restrict で to verb て-form contexts
    // (preceded by a non-particle character that could be a verb stem)
    const parts = text.split(/(て|(?<=[いきしちにびみりぎじえけせてねべめれげぜっん])で|たり|ながら|ば|けれど|けど|のに(?!ち)|(?<=.)が(?=[^、]))/);
    const merged = this.mergeDelimiters(parts);
    return this.buildSegments(merged, 'clause', text);
  }

  /** Utterance: split on sentence-final markers */
  private segmentUtterance(text: string): TextSegment[] {
    const parts = text.split(/([。！？!?]+|(?:\.{3}|…))/);
    const merged = this.mergeDelimiters(parts);
    return this.buildSegments(merged, 'utterance', text);
  }

  /** Turn: each line = one turn */
  private segmentTurn(text: string): TextSegment[] {
    const lines = text.split('\n');
    return this.buildSegments(lines.filter((l) => l.length > 0), 'turn', text);
  }

  /** Exchange: group consecutive turns into pairs */
  private segmentExchange(text: string): TextSegment[] {
    const lines = text.split('\n').filter((l) => l.length > 0);
    const pairs: string[] = [];
    for (let i = 0; i < lines.length; i += 2) {
      const pair = i + 1 < lines.length ? `${lines[i]}\n${lines[i + 1]}` : lines[i];
      pairs.push(pair);
    }
    return this.buildSegments(pairs, 'exchange', text);
  }

  /** Episode: group by blank-line paragraph breaks */
  private segmentEpisode(text: string): TextSegment[] {
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    return this.buildSegments(paragraphs, 'episode', text);
  }

  /** Reattach split delimiters to preceding chunk */
  private mergeDelimiters(parts: string[]): string[] {
    const merged: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].length === 0) continue;
      // If this part looks like a delimiter and there's a previous chunk, attach it
      if (i > 0 && parts[i].length <= 3 && merged.length > 0 && !/[\u4E00-\u9FFF\u3400-\u4DBF]{2,}/.test(parts[i])) {
        merged[merged.length - 1] += parts[i];
      } else {
        merged.push(parts[i]);
      }
    }
    return merged.filter((s) => s.trim().length > 0);
  }
}
