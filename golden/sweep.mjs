/**
 * golden/sweep.mjs — class-aware sweep matchers (DESIGN §15).
 *
 * The sweep is a CANDIDATE machine: every structural find is `suggested`, only
 * the caller's near-verbatim path confirms. Contract per class:
 *   🔵 components in order, tight gap, final component may inflect
 *   🟠 link parts in order, clause-scale gap
 *   💠 frame fixed material in order with a FILLED, bounded slot
 *   🟢 the halo rendering (bare lemma NOT sweepable)
 * Plus the store rules: suggested never downgrades confirmed, rejection is
 * remembered, ratification clears status.
 *
 * Run:  node golden/sweep.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const S = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'sweep-match.ts')).href);
const P = await import(pathToFileURL(join(HERE, '..', 'src', 'notes', 'pattern-store.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const lines = (...texts) => texts.map((text, index) => ({ index, tStartSec: index * 5, text }));
const entry = (cls, key, payload = {}) => ({ class: cls, keyKind: 'surface', key, payload });

console.log('══ findTermAll: exact + deinflect-validated inflection ══');
{
  const occ = S.findTermAll('昨日たこ焼きを食べたんだよ', '食べる');
  check('食べる finds 食べた (inflected)', occ.length === 1 && occ[0].inflected, JSON.stringify(occ));
  const occ2 = S.findTermAll('毎日食べる人', '食べる');
  check('exact hit not marked inflected', occ2.length === 1 && !occ2[0].inflected);
  const occ3 = S.findTermAll('食べていたところ', '食べる');
  check('longest inflection wins (食べていた)', occ3.length === 1 && occ3[0].span.end - occ3[0].span.start === 5, JSON.stringify(occ3));
  check('no hit in unrelated text', S.findTermAll('全然関係ない話', '食べる').length === 0);
  check('noun with る-tail does not false-fire', S.findTermAll('こする話', 'こする').length === 1);
}

console.log('══ 🔵 collocation ══');
{
  const e = entry('collocation', '気になる');
  const hits = S.sweepEntry(e, lines('その話がずっと気になってたんだ'));
  check('surface key matches inflected 気になって', hits.length === 1 && hits[0].matchKind === 'surface-inflected', JSON.stringify(hits));
  check('suggested quote carries context', hits.length === 1 && hits[0].quote.includes('気になって'));
  const parts = entry('collocation', '約束を守る', { parts: ['約束', '守る'] });
  const h2 = S.sweepEntry(parts, lines('彼は約束をちゃんと守った人だ'));
  check('components in order w/ inflected verb', h2.length === 1 && h2[0].matchKind === 'components', JSON.stringify(h2));
  const h3 = S.sweepEntry(parts, lines('約束の話。それとは別に城を守った'));
  check('too-far components rejected (gap>10)', h3.length === 0, JSON.stringify(h3));
  const h4 = S.sweepEntry(parts, lines('城を守ったのは約束のためだ'));
  check('wrong order rejected', h4.length === 0, JSON.stringify(h4));
}

console.log('══ 🟠 skeletal link ══');
{
  const e = { class: 'skeletal', keyKind: 'link', key: 'んだったら〜なきゃ', payload: { parts: ['んだったら', 'なきゃ'] } };
  const h = S.sweepEntry(e, lines('行くんだったら早く準備しなきゃだめだよ'));
  check('link parts across a clause', h.length === 1 && h[0].matchKind === 'link', JSON.stringify(h));
  const miss = S.sweepEntry(e, lines('行くんだったら早くしよう'));
  check('missing second part → no hit', miss.length === 0);
}

console.log('══ 💠 phrase schema ══');
{
  const e = { class: 'phrase_schema', keyKind: 'frame', key: '○○といえば○○', payload: { frame: '○○といえば○○' } };
  const h = S.sweepEntry(e, lines('大阪といえばたこ焼きだよね'));
  check('frame with filled slots', h.length === 1 && h[0].matchKind === 'frame', JSON.stringify(h));
  const miss = S.sweepEntry(e, lines('といえば。それは別の話'));
  check('empty slot → no hit', miss.length === 0, JSON.stringify(miss));
  const e2 = { class: 'phrase_schema', keyKind: 'frame', key: '○○ば○○ほど', payload: { frame: '○○ば○○ほど' } };
  const h2 = S.sweepEntry(e2, lines('見れば見るほど不思議な絵だ'));
  check('multi-segment frame w/ bounded slot', h2.length === 1, JSON.stringify(h2));
  const miss2 = S.sweepEntry(e2, lines('見れば分かる。今日はほどほどにしよう'));
  check('clause-break in slot → no hit', miss2.length === 0, JSON.stringify(miss2));
}

console.log('══ 🟢 rhet-collocation ══');
{
  const withHalo = { class: 'rhet_collocation', keyKind: 'surface', key: '気', payload: { lemma: '気', halo: '気が済むまで' } };
  const h = S.sweepEntry(withHalo, lines('気が済むまでやればいいよ'));
  check('halo rendering matches', h.length === 1 && h[0].matchKind === 'halo', JSON.stringify(h));
  const bare = { class: 'rhet_collocation', keyKind: 'surface', key: '気', payload: { lemma: '気' } };
  const none = S.sweepEntry(bare, lines('気が済むまでやればいいよ。天気もいいし'));
  check('bare lemma is NOT sweepable (evocation test is human-only)', none.length === 0, JSON.stringify(none));
}

console.log('══ windows + caps ══');
{
  const e = entry('collocation', '気になる');
  const h = S.sweepEntry(e, lines('それがどうしても気に', 'なってしまって困る'));
  check('match straddling two caption lines', h.length === 1, JSON.stringify(h));
  const many = S.sweepEntry(e, lines(...Array.from({ length: 10 }, () => '本当に気になる話だ')));
  check(`per-file cap ${S.MAX_CANDIDATES_PER_FILE}`, many.length === S.MAX_CANDIDATES_PER_FILE, String(many.length));
  check('🔴 discourse never swept', S.sweepableClass('discourse') === false);
  check('🟡 serifu not handled here (verbatim path owns it)', S.sweepableClass('serifu') === false);
}

console.log('══ precision hardening (adversarial set, 2026-07-17) ══');
{
  // kanji–kanji junction = inside a larger compound = different lexeme
  const kinaru = entry('collocation', '気になる');
  check('本気になって does NOT attest 気になる', S.sweepEntry(kinaru, lines('あいつ、ついに本気になってきたな')).length === 0);
  check('…が気になって still attests (kanji→kana junction legal)', S.sweepEntry(kinaru, lines('その話がずっと気になってたんだ')).length === 1);
  const yakusoku = entry('collocation', '約束を守る', { parts: ['約束', '守る'] });
  check('口約束 does NOT attest 約束 component', S.sweepEntry(yakusoku, lines('口約束だけど守ってくれた')).length === 0);
  check('毎日食べる attests 食べる (2-kanji word before is not a prefix)', S.findTermAll('毎日食べる人', '食べる').length === 1);
  // 🔵 gap must be one phrase: no punctuation inside
  check('約束はさ、守る… rejected (、in gap)', S.sweepEntry(yakusoku, lines('約束はさ、守るとかじゃなくて')).length === 0);
  check('約束をちゃんと守った still attests', S.sweepEntry(yakusoku, lines('彼は約束をちゃんと守った人だ')).length === 1);
  // 🟠 clause-scale gap must not cross a sentence boundary
  const link = { class: 'skeletal', keyKind: 'link', key: 'だったら〜なきゃ', payload: { parts: ['だったら', 'なきゃ'] } };
  check('だったら…。…なきゃ rejected (sentence break)', S.sweepEntry(link, lines('昨日だったら良かったのに。もう仕事行かなきゃ')).length === 0);
  check('だったら…、…なきゃ still links (、is clause-scale)', S.sweepEntry(link, lines('行くんだったらさ、早く準備しなきゃ')).length === 1);
  // 💠 short single-segment frames are not sweepable (compositional-use flood)
  const toshite = { class: 'phrase_schema', keyKind: 'frame', key: '○○として', payload: { frame: '○○として' } };
  check('○○として not sweepable (fires on 結果として etc.)', S.sweepEntry(toshite, lines('結果として何も変わらなかった')).length === 0);
  const wakeda = { class: 'phrase_schema', keyKind: 'frame', key: '○○というわけだ', payload: { frame: '○○というわけだ' } };
  check('≥4-char single-seg frame still sweepable', S.sweepEntry(wakeda, lines('つまり彼が犯人というわけだ')).length === 1);
  // deinflection needs a real stem: 1-char kana stems match inside okurigana
  check('いる does not fire inside 書いた', S.findTermAll('手紙を書いたところだ', 'いる').length === 0);
  check('1-char KANJI stem still deinflects (見る→見た)', S.findTermAll('映画を見たよ', '見る').length === 1);
}

console.log('══ sweepMuted: the ✓✕ record steers the sweep ══');
{
  const att = (ratifiedSweep) => ({ source: 'yt', quote: 'q', addedAt: 1, matchKind: 'components', ...(ratifiedSweep ? {} : { status: 'suggested' }) });
  check('fresh entry not muted', !S.sweepMuted({ attestations: [], rejectedAtts: [] }));
  check('2 rejections not muted', !S.sweepMuted({ attestations: [], rejectedAtts: ['a', 'b'] }));
  check('3 rejections + no ratified sweep → muted', S.sweepMuted({ attestations: [att(false)], rejectedAtts: ['a', 'b', 'c'] }));
  check('a ratified sweep hit buys back 5 strikes', !S.sweepMuted({ attestations: [att(true)], rejectedAtts: ['a', 'b', 'c'] }));
  check('8 rejections overwhelm 1 ratification (3+5)', S.sweepMuted({ attestations: [att(true)], rejectedAtts: 'abcdefgh'.split('') }));
}

console.log('══ store: suggested/ratify/reject rules ══');
{
  const att = (status) => ({ source: 'yt', file: 'T/v.md', tStartSec: 30, quote: '気になってた', addedAt: 1, ...(status ? { status: 'suggested', matchKind: 'surface-inflected', confidence: 0.7 } : {}) });
  // suggested add
  let e = P.upsertEntry(undefined, '気になる', att(true), 1);
  check('suggested attestation lands with status', e.attestations[0]?.status === 'suggested');
  // suggested never downgrades confirmed
  let c = P.upsertEntry(undefined, '気になる', att(false), 1);
  c = P.upsertEntry(c, '気になる', att(true), 2);
  check('suggested never downgrades confirmed', c.attestations.length === 1 && !c.attestations[0].status);
  // confirmed upgrades suggested
  e = P.upsertEntry(e, '気になる', att(false), 2);
  check('confirmed upgrades suggested in place', e.attestations.length === 1 && !e.attestations[0].status);
  // rejection memory blocks re-add
  const key = P.attestationKey(att(true));
  const rej = { ...P.upsertEntry(undefined, '気になる', null, 1), rejectedAtts: [key] };
  const after = P.upsertEntry(rej, '気になる', att(true), 2);
  check('rejected attKey is never re-added', after.attestations.length === 0);
}

console.log(fail ? `\n✗ sweep: ${fail} failed (${pass} passed)` : `\n✓ sweep: all ${pass} pass`);
process.exit(fail ? 1 : 0);
