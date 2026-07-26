/**
 * golden/deinflect.mjs — dictionary deinflection (DESIGN §13.4).
 *
 * The deinflector only PROPOSES candidates (the dictionary validates), so the
 * contract is: for each common inflected form, the correct dictionary form is
 * among the candidates, with a sane trail — and junk inputs stay cheap.
 *
 * Run:  node golden/deinflect.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const D = await import(pathToFileURL(join(HERE, '..', 'src', 'dictionary', 'deinflect.ts')).href);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};
const has = (input, want) => D.deinflect(input).some((d) => d.term === want);
const trailOf = (input, want) => D.deinflect(input).find((d) => d.term === want)?.trail ?? null;

console.log('══ one-hop inflections ══');
check('食べた → 食べる (ichidan past)', has('食べた', '食べる'));
check('買った → 買う (godan past)', has('買った', '買う'));
check('飲んで → 飲む (godan te)', has('飲んで', '飲む'));
check('書いた → 書く', has('書いた', '書く'));
check('泳いだ → 泳ぐ', has('泳いだ', '泳ぐ'));
check('話した → 話す', has('話した', '話す'));
check('行きます → 行く (polite)', has('行きます', '行く'));
check('読まない → 読む (negative)', has('読まない', '読む'));
check('食べられる → 食べる (passive/potential)', has('食べられる', '食べる'));
check('書けば → 書く (conditional)', has('書けば', '書く'));
check('行こう → 行く (volitional)', has('行こう', '行く'));
check('飲みたい → 飲む (desiderative)', has('飲みたい', '飲む'));
check('高かった → 高い (adj past)', has('高かった', '高い'));
check('高くない → 高い (adj negative)', has('高くない', '高い'));
check('早く → 早い (adverbial)', has('早く', '早い'));

console.log('══ chains (multi-hop) ══');
check('食べていた → 食べる (progressive past)', has('食べていた', '食べる'));
check('食べてた → 食べる (contracted progressive)', has('食べてた', '食べる'));
check('飲んじゃった → 飲む (contraction)', has('飲んじゃった', '飲む'));
check('食べちゃう → 食べる', has('食べちゃう', '食べる'));
check('行きませんでした → 行く (polite past neg)', has('行きませんでした', '行く'));
check('読まなかった → 読む (past negative)', has('読まなかった', '読む'));
check('書いてみる → 書く (attemptive)', has('書いてみる', '書く'));
check('食べておく → 食べる (preparatory)', has('食べておく', '食べる'));
check('高くなかった → 高い (adj past neg)', has('高くなかった', '高い'));

console.log('══ irregulars ══');
check('しました → する', has('しました', 'する'));
check('しない → する', has('しない', 'する'));
check('きた → くる', has('きた', 'くる'));
check('こない → くる', has('こない', 'くる'));
check('勉強した → 勉強する', has('勉強した', '勉強する'));

console.log('══ hygiene ══');
{
  const trail = trailOf('食べていた', '食べる');
  check('trail explains the path', Array.isArray(trail) && trail.length >= 1 && trail.length <= 3,
    JSON.stringify(trail));
  check('input itself is never a candidate', !has('食べる', '食べる'));
  check('non-inflected word → few/no candidates', D.deinflect('こんにちは').length <= 8);
  check('bounded output on junk', D.deinflect('たたたたたたたた').length <= 64);
  check('empty stays empty', D.deinflect('').length === 0);
  check('た alone (no stem) proposes nothing', D.deinflect('た').length === 0);
}

console.log(`\n${fail ? '✗' : '✓'} deinflect: ${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
