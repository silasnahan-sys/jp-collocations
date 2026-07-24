/**
 * golden/calculus-turns.mjs — the EVIDENCE CHAIN test (Amendment IV).
 *
 * The Phase-0 golden silently hand-performed three editorial acts:
 * segmentation, backchannel exclusion, speaker attribution. This golden
 * asserts those acts are now deterministic code. The headline check:
 * fragment merging repairs the RESUME trigger that YouTube ASR bisected
 * across two lines at imiron [1:37:38] (疑問戻っ|ていいですか) — a move
 * line-level matching can structurally never see.
 *
 * (golden/turns.mjs tests the DIFFERENT hand-marked 談話モード turn model
 * in src/discourse/turns.ts; this file tests the automatic evidence chain
 * in src/discourse/calculus/turns.mjs.)
 *
 *   node golden/calculus-turns.mjs
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (p) => import(pathToFileURL(join(HERE, '..', 'src', 'discourse', p)).href);
const { parseTranscript, buildTurns, gradeBackchannel } = await imp('calculus/turns.mjs');
const { turnsFromHandMarks } = await imp('calculus/handmarks.mjs');
const { reduce } = await imp('calculus/scoreboard.mjs');
const { recognizeEvents } = await imp('calculus/moves.mjs');

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => { n++; if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`); };

// ── 1. Timestamp formats — the trap that bit the audit itself ──
console.log('══ parse: [MM:SS] and [H:MM:SS] ══');
{
  const md = '[00:02] まずは判定しましょう。\n[59:59] 前半終わり\n[1:00:03] 後半です\n[3:03:21] 皆さん見てみてくださいね\n[07:19] [笑い]\n';
  const lines = parseTranscript(md);
  ok(lines.length === 4, 'both formats parse, stage directions dropped', `(${lines.length})`);
  ok(lines[2].tSec === 3603, 'H:MM:SS arithmetic is right', `(${lines[2].tSec})`);
  ok(lines[3].tSec === 3 * 3600 + 3 * 60 + 21, '3-hour timestamps survive');
}

// ── 2. THE HEADLINE — merge repairs the ASR-bisected RESUME trigger ──
console.log('\n══ fragment merge repairs 疑問戻っ|ていいですか (imiron [1:37:38], verbatim) ══');
{
  const md = [
    '[1:37:35] 最初ぼんやりしたまま結局進んできて今俺',
    '[1:37:38] 結局分かってねえやってなった話疑問戻っ',
    '[1:37:40] ていいですか思い出したんですかなんか',
  ].join('\n');
  const { turns } = buildTurns(parseTranscript(md));
  const merged = turns.map(t => t.text).join('|');
  ok(turns.some(t => t.text.includes('疑問戻っていいですか')), 'bisected trigger is whole again', `(${merged.slice(0, 60)}…)`);
}

// ── 3. Backchannels are grounding events, not turns (graded) ──
console.log('\n══ backchannel lifting + Clark grading ══');
{
  ok(gradeBackchannel('うん。うん。') === 'ack', 'うん = ack (continuer)');
  ok(gradeBackchannel('なるほど') === 'accept', 'なるほど = accept (uptake)');
  ok(gradeBackchannel('確かに。') === 'accept', '確かに = accept');
  ok(gradeBackchannel('そこは違うと思う') === null, 'substantive text is NOT a backchannel');
  const md = [
    '[07:36] 社会として職業訓練を大企業が担おうってさ。',
    '[07:41] うん。',
    '[07:45] 社会のための投資を強いられてるわけでしょ。',
    '[07:50] うん。うん。',
  ].join('\n');
  const { turns, stats } = buildTurns(parseTranscript(md));
  ok(turns.length === 2, 'backchannel lines are lifted out of the turn sequence', `(${turns.length} turns)`);
  ok(stats.lifted === 2, 'both continuers became grounding events');
  ok(turns[0].grounding.length === 1 && turns[1].grounding.length === 1, 'grounding attaches to the turn it grounds');
  ok(turns[0].grounding[0].by !== turns[0].speaker, 'grounding comes from the non-floor-holder');
}

// ── 4. Speaker inference — declared rules, auditable provenance ──
console.log('\n══ two-party floor inference ══');
{
  const md = [
    '[00:02] まずは判定しましょう。職場での年功序列はありか?会社を経営している堀本さんいかがでしょうか?',
    '[00:08] なしです。',
    '[00:11] 実力主義です。',
    '[00:16] いや、擁護してもいい要素はあるんじゃないかと思うので。',
  ].join('\n');
  const { turns } = buildTurns(parseTranscript(md));
  ok(turns[1].speaker !== turns[0].speaker, 'R1: question → response switches floor', `(${turns[1].speakerRule})`);
  ok(turns[2].speaker === turns[1].speaker, 'R4: floor continues without a switch cue');
  ok(turns[3].speaker !== turns[2].speaker, 'R2: いや-initial switches floor', `(${turns[3].speakerRule})`);
  ok(turns.every(t => t.speakerSource === 'inferred' && t.speakerRule), 'every attribution carries its rule (honesty contract)');
}

// ── 5. DE-FUSING — embedded uptake inside merged ASR turns ──
// (imiron measured: 348 uptake tokens embedded vs 3 lifted = 0.9% grounding
//  recall; ~27% of turns carried the other speaker's voice. These cases pin
//  the three outcomes.)
console.log('\n══ de-fusing: the listener\'s voice inside the speaker\'s turn ══');
{
  // (a) excise: continuer over the pause → grounding event, floor returns
  const a = buildTurns(parseTranscript('[10:00] 集合体みたいなものがあってはいはいうんうんそれで女王というまとまりを指すわけです。'));
  ok(a.turns.length === 1 && !a.turns[0].text.includes('はいはい'), 'mid-turn はいはい excised, text glued', `(${a.turns[0].text.slice(0, 24)}…)`);
  ok(a.turns[0].grounding.length === 1 && a.turns[0].grounding[0].grade === 'ack' && a.turns[0].grounding[0].embedded,
    'run becomes an EMBEDDED grounding event, graded ack');

  // (b) accept grading
  const b = buildTurns(parseTranscript('[10:05] これが基本の考え方でしてなるほど確かにそれでですね続きがあります。'));
  ok(b.turns[0]?.grounding[0]?.grade === 'accept', 'なるほど確かに run grades accept');

  // (c) floor-take: uptake then じゃあ… → grounding on head, tail = other party
  const c = buildTurns(parseTranscript('[10:10] そういう仕組みなんですよなるほどじゃあ先生のご関心を伺えればと思うんですけど。'));
  ok(c.turns.length === 2 && c.turns[1].speaker !== c.turns[0].speaker,
    'なるほど+じゃあ → the interjector TAKES the floor', `(${c.turns[1]?.speakerRule})`);
  ok(c.turns[0].grounding.length === 1 && c.turns[0].grounding[0].by === c.turns[1].speaker,
    'the grounding is credited to the party who then speaks');

  // (d) question fused with its answer → split; uptake-initial tail
  const d = buildTurns(parseTranscript('[10:15] 意味論って言語学の分野なんですかなるほどそうですね私はメリーランド大学で哲学をやってまして。'));
  ok(d.turns.length === 2 && d.turns[1].speaker !== d.turns[0].speaker && d.turns[1].text.startsWith('なるほど'),
    'question|answer de-fused; answer keeps its uptake head', `(${d.turns[1]?.speakerRule})`);

  // guards: precision-first vocabulary
  const e = buildTurns(parseTranscript('[10:20] なるほどそういうことですね、面白い。'));
  ok(e.turns.length === 1 && e.turns[0].text.startsWith('なるほど'), 'turn-INITIAL uptake is the speaker\'s own — untouched');
  const f = buildTurns(parseTranscript('[10:25] 結局それが大事ですよね、だから先に進めましょう。'));
  ok(f.turns[0].text.includes('ですよね') && f.turns[0].grounding.length === 0,
    'ですよね is NOT excised (it is the speaker\'s own conscription marker)');
}

// ── 6. THE TRUTH CHANNEL — 談話モード hand-marks feed the calculus ──
console.log('\n══ truth channel: hand-marked TurnRefs → reducer turns ══');
{
  // the ゆる哲学ラジオ case from golden/turns.mjs, verbatim
  const LINES = [
    { text: 'フランス革命がないと今の僕らの暮らし全然違います。', tStartSec: 10 },
    { text: 'うん。そこまで言う。急にゆる歴史ラジオ回とね、', tStartSec: 14 },
    { text: '思った方もいらっしゃると思うんですけども、今さ、', tStartSec: 17 },
  ];
  const marks = [
    { start: 0, speaker: 'A' },
    { start: 1, speaker: 'B' },
    { start: 1, char: 10, speaker: 'A' },
  ];
  const { turns } = turnsFromHandMarks(LINES, marks);
  ok(turns.length === 3, 'mid-line boundary honored (turns.ts slice math reused)', `(${turns.length})`);
  ok(turns.map(t => t.speaker).join('') === 'ABA', 'speakers are GIVEN, not inferred', `(${turns.map(t => t.speaker).join('')})`);
  ok(turns[1].text === 'うん。そこまで言う。', 'reaction WITH content stays a real turn (そこまで言う is a move)');
  ok(turns.every(t => t.speakerSource === 'hand'), 'provenance says hand');

  // a pure-backchannel hand-turn lifts into grounding with a GIVEN speaker
  const L2 = [
    { text: 'これが結論です。', tStartSec: 10 },
    { text: 'うん。', tStartSec: 12 },
    { text: '次に行きましょう。', tStartSec: 14 },
  ];
  const m2 = [{ start: 0, speaker: 'A' }, { start: 1, speaker: 'B' }, { start: 2, speaker: 'A' }];
  const h2 = turnsFromHandMarks(L2, m2);
  ok(h2.turns.length === 2 && h2.turns[0].grounding.length === 1, 'pure backchannel hand-turn lifts to grounding');
  ok(h2.turns[0].grounding[0].by === 'B' && h2.turns[0].grounding[0].given === true,
    'grounding speaker is ground truth (given), not a floor guess');

  // and the reducer consumes it unchanged (auto chain and truth channel are interchangeable)
  const board = reduce(h2.turns, recognizeEvents);
  ok(board.turns.length === 2 && board.log.some(l => l.prim === 'ACKNOWLEDGE'),
    'reducer folds hand-marked turns with zero adaptation');
}

// ── 7. Determinism ──
console.log('\n══ determinism ══');
{
  const md = '[00:01] これはテストですけど。\n[00:03] うん。\n[00:05] そうですね、続きです。';
  const a = JSON.stringify(buildTurns(parseTranscript(md)));
  const b = JSON.stringify(buildTurns(parseTranscript(md)));
  ok(a === b, 'identical input → byte-identical turns');
  const fused = '[10:00] 集合体みたいなものがあってはいはいうんうんそれで続きです。';
  ok(JSON.stringify(buildTurns(parseTranscript(fused))) === JSON.stringify(buildTurns(parseTranscript(fused))),
    'de-fusing is deterministic');
}

console.log(`\n${fail ? '✗' : '✓'} calculus-turns: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
