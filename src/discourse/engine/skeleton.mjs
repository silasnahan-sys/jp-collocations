// _tmp_pipeline/skeleton.mjs
// Content-word stripper that reveals the discourse-grammar skeleton.
//
// v2 (audit fix-list §9 item 6) — TYPED SLOT MASK:
//   - kanji compound followed by a verbal morpheme → ░V░ (verb stem)
//   - i-adjective stem (kanji + い) → ░A░
//   - quoted span 「...」 / 『...』 → ░Q░
//   - numerals (0-9, ０-９) → ░#░
//   - katakana run → ░K░ (often loanword noun / name)
//   - kanji run (default) → ░N░ (noun-ish)
//   - ASCII letter run → ░E░ (English/Latin)
// WEIGHTY-PARTICLE WHITELIST: never masked — they are the skeleton.
//   って / に対して / に関して / について / によって / にとって / として /
//   からこそ / わけ / もの / ところ / くらい / ぐらい / ばかり / だけ /
//   しか / さえ / こそ / すら / なんて / どころか

const QUOTE_RE = /[「『][^「『」』]*[」』]/g;
const NUMERIC_RE = /[0-9０-９][0-9０-９,，.．]*/g;
const KATA_RE = /[ァ-ヴー]+/g;
const ASCII_RE = /[A-Za-z][A-Za-z\-]*/g;
// Kanji+い = i-adjective stem (heuristic, may catch some nouns ending in い).
const I_ADJ_RE = /[一-龥々]+(?:しい|い)(?=[ぁ-んをにがはもでとへやか、。！？\s]|$)/g;
// Kanji compound followed by verbal morpheme = verb stem.
const VERB_STEM_RE = /[一-龥々]+(?=(?:する|します|した|して|させ|され|られ|られる|る|ます|ました|った|っ|い|き|く|け|こ|わ|い|う|え|お|ば|み|む|め|も|に|ね|の|び|ぶ|べ|ぼ|り|る|れ|ろ|ぎ|ぐ|げ|ご|じ|ず|ぜ|ぞ|ち|つ|て|と|し|せ|そ)[ぁ-ん]?[てたずぬずれろうい]?)/g;
// Generic kanji compound (catches what verb-stem missed) → ░N░.
const KANJI_RE = /[一-龥々〆ヵヶ]+/g;

/** Strip content-bearing runs from a sentence, emitting typed slots. */
export function mask(s) {
  if (!s) return '';
  // Order matters. Process ASCII FIRST so we don't accidentally re-match the
  // typed slot tag letters (N/V/A/K/E/Q/#) we are about to insert.
  let out = s.replace(ASCII_RE, '░E░');
  out = out.replace(QUOTE_RE, '░Q░');
  out = out.replace(NUMERIC_RE, '░#░');
  out = out.replace(I_ADJ_RE, '░A░');
  // Verb stem: kanji prefix + sahen/finite verb starter — replace prefix only.
  out = out.replace(/[一-龥々]{1,4}(?=(?:する|します|した|して|させ|され|られ))/g, '░V░');
  out = out.replace(KATA_RE, '░K░');
  out = out.replace(KANJI_RE, '░N░');
  // Collapse runs of bare ░ but keep typed tokens distinct.
  out = out.replace(/░(?![NVAKEQ#])░/g, '░');
  return out;
}

/** Plain (untyped) mask — kept for back-compat where only structure is needed. */
export function maskFlat(s) {
  if (!s) return '';
  return s
    .replace(/[一-龥々〆ヵヶ]+/g, '░')
    .replace(/[ァ-ヴー]+/g, '░')
    .replace(/[A-Za-z]+/g, '░')
    .replace(/[0-9０-９]+/g, '░')
    .replace(/░+/g, '░');
}

/** Split skeleton at the ░ marker, returning the surviving grammar segments. */
export function segments(skel) {
  if (!skel) return [];
  return skel.split(/░[NVAKEQ#]?░?/).map(s => s.trim()).filter(Boolean);
}

/** Normalize punctuation in the skeleton for template counting. */
export function template(skel) {
  return skel
    .replace(/[、,]/g, '、')
    .replace(/[。.]/g, '。')
    .replace(/[！!]/g, '！')
    .replace(/[？?]/g, '？');
}

/** Detect a small inventory of frame templates from the skeleton. */
const FRAME_TEMPLATES = [
  { id: 'DEFINITION-NP-COPULA',  re: /░N░?(?:というのは|って).*ということ(?:です|だ)/ },
  { id: 'TOPIC-IS-NP',           re: /░N░?は.*░N░?(?:です|だ)[。．！？]?$/ },
  { id: 'COMPARISON-NI-TAISHITE', re: /░N░?に対して░N░?は/ },
  { id: 'QUOTE-REPORT',          re: /(?:と|って)(?:言|思|聞)/ },
  { id: 'CONDITIONAL-TARA',      re: /░V░?(?:たら|れば|なら).*[。．]?$/ },
  { id: 'HEDGED-CLAIM',          re: /(?:んです|なんです).*(?:けど|けれども|よね?)[。．]?$/ },
];

export function detectFrame(skel) {
  for (const f of FRAME_TEMPLATES) if (f.re.test(skel)) return f.id;
  return null;
}

/** Full skeleton record for a single sentence. */
export function skeletonOf(text) {
  const skel = mask(text);
  return {
    raw: text,
    skel,
    template: template(skel),
    segs: segments(skel),
    frame: detectFrame(skel),
  };
}
