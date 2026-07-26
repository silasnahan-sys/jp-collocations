/**
 * golden/srs.mjs — the SRS core: scheduler (SM-2 lineage), deck store queue
 * policy, and the class-shaped review-card builder.
 *
 * Run:  node golden/srs.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (p) => import(pathToFileURL(join(HERE, '..', 'src', 'srs', p)).href);
const S = await load('scheduler.ts');
const ST = await load('srs-store.ts');
const RC = await load('review-cards.ts');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};

const MIN = 60_000, DAY = 86_400_000;
const T0 = 1_700_000_000_000; // fixed epoch — no Date.now() in tests

console.log('══ scheduler: learning ladder ══');
{
  let s = S.newCardState(T0);
  check('new card is due immediately', S.isDue(s, T0));
  check('new card starts in state=new', s.state === 'new' && s.reps === 0);
  s = S.schedule(s, 3, T0);                       // good
  check('good on new → learning, +1min step done → 10min', s.state === 'learning' && Math.round((s.dueMs - T0) / MIN) === 10);
  s = S.schedule(s, 3, s.dueMs);                  // good again → graduate
  check('good again → review at 1 day', s.state === 'review' && s.intervalDays === 1);
  const easy = S.schedule(S.newCardState(T0), 4, T0);
  check('easy on new → review at 4 days', easy.state === 'review' && easy.intervalDays === 4);
  const again = S.schedule(S.newCardState(T0), 1, T0);
  check('again on new → learning step 0 (1min)', again.state === 'learning' && Math.round((again.dueMs - T0) / MIN) === 1);
  const hard = S.schedule(S.newCardState(T0), 2, T0);
  check('hard on new → repeats first step', hard.state === 'learning' && hard.stepIndex === 0);
}

console.log('══ scheduler: review growth + lapse ══');
{
  // a graduated review card at 10 days, ease 2500
  const base = { state: 'review', dueMs: T0, intervalDays: 10, ease: 2500, reps: 5, lapses: 0, stepIndex: 0 };
  const good = S.schedule(base, 3, T0);
  check('good multiplies interval by ease (10→25d)', good.intervalDays === 25 && good.state === 'review');
  const easy = S.schedule(base, 4, T0);
  check('easy > good interval', easy.intervalDays > good.intervalDays);
  check('easy raises ease', easy.ease > base.ease);
  const hard = S.schedule(base, 2, T0);
  check('hard grows slowly (×1.2) and lowers ease', hard.intervalDays === 12 && hard.ease < base.ease);
  const lapse = S.schedule(base, 1, T0);
  check('again → relearning, lapse counted', lapse.state === 'relearning' && lapse.lapses === 1);
  check('lapse halves interval, lowers ease', lapse.intervalDays === 5 && lapse.ease === 2300);
  check('lapse due in 10min (relearn step)', Math.round((lapse.dueMs - T0) / MIN) === 10);
  // ease floor
  let low = { ...base, ease: 1300 };
  low = S.schedule(low, 2, T0);
  check('ease never drops below floor', low.ease >= 1300);
  // interval always advances by ≥1 day on review-good
  const one = S.schedule({ ...base, intervalDays: 1, ease: 1300 }, 3, T0);
  check('interval strictly increases', one.intervalDays >= 2);
  // max cap
  const capped = S.schedule({ ...base, intervalDays: 300, ease: 2500 }, 4, T0);
  check('interval capped at 365d', capped.intervalDays === 365);
}

console.log('══ scheduler: relearning graduation ══');
{
  const relearn = { state: 'relearning', dueMs: T0, intervalDays: 5, ease: 2300, reps: 6, lapses: 1, stepIndex: 0 };
  const g = S.schedule(relearn, 3, T0);
  check('good in relearning → back to review, keeps halved interval', g.state === 'review' && g.intervalDays === 5);
  const again = S.schedule(relearn, 1, T0);
  check('again in relearning → step 0, still relearning', again.state === 'relearning' && again.stepIndex === 0);
}

console.log('══ previews ══');
{
  const base = { state: 'review', dueMs: T0, intervalDays: 10, ease: 2500, reps: 5, lapses: 0, stepIndex: 0 };
  const p = S.previewIntervals(base, T0);
  check('four labels present', p[1] && p[2] && p[3] && p[4]);
  check('good preview reads in days/months', /日|ヶ月/.test(p[3]), p[3]);
  check('again preview reads in minutes', /分/.test(p[1]), p[1]);
}

console.log('══ deck store: queue policy ══');
{
  const store = new ST.SrsStore(async () => {});
  const ids = ['a', 'b', 'c', 'd', 'e'];
  // a = due review, b = due learning, c = new, d = future review, e = new
  store.load({ cards: {
    a: { state: 'review', dueMs: T0 - DAY, intervalDays: 10, ease: 2500, reps: 3, lapses: 0, stepIndex: 0 },
    b: { state: 'learning', dueMs: T0 - MIN, intervalDays: 0, ease: 2500, reps: 1, lapses: 0, stepIndex: 1 },
    d: { state: 'review', dueMs: T0 + 5 * DAY, intervalDays: 10, ease: 2500, reps: 3, lapses: 0, stepIndex: 0 },
  } });
  const q = store.buildQueue(ids, T0, 20);
  check('learning comes before due review', q.indexOf('b') < q.indexOf('a'));
  check('due review before new', q.indexOf('a') < q.indexOf('c'));
  check('future card excluded', !q.includes('d'));
  check('both new cards included', q.includes('c') && q.includes('e'));
  const counts = store.counts(ids, T0);
  check('counts: 1 learn / 1 due / 2 fresh', counts.learn === 1 && counts.due === 1 && counts.fresh === 2);
  const capped = store.buildQueue(ids, T0, 1);
  check('newPerSession caps fresh cards', capped.filter((x) => x === 'c' || x === 'e').length === 1);
}

console.log('══ deck store: review persists + prune ══');
{
  let saved = null;
  const store = new ST.SrsStore(async (d) => { saved = d; });
  await store.review('x', 3, T0);
  check('first review seeds the card', store.stateOf('x') && store.stateOf('x').reps === 1);
  check('persisted', saved && saved.cards.x);
  await store.review('y', 3, T0);
  const removed = await store.prune(new Set(['x']));
  check('prune removes dead ids', removed === 1 && !store.stateOf('y') && store.stateOf('x'));
}

console.log('══ review-card builder: class-shaped ══');
{
  const mk = (cls, payload, atts, key) => ({
    id: 'p1', class: cls, classRatified: true, keyKind: 'surface', key: key ?? 'X',
    note: key ?? 'X', payload: payload ?? {}, attestations: atts ?? [], createdAt: 1, updatedAt: 1,
  });
  const ytAtt = (quote, anchored) => ({ source: 'yt', file: 'T/A.md', tStartSec: 100, quote, anchorId: anchored ? 'a1' : undefined, addedAt: 1 });

  // 🟠 skeletal: first component shown, mate blanked, back bolds both
  const sk = RC.buildReviewCard(mk('skeletal', { parts: ['んだったら', 'なきゃ'] }, [ytAtt('転売するんだったら行き渡らなきゃ', true)], 'んだったら〜なきゃ'));
  check('🟠 front shows first component + blank', sk.frontLines.some((l) => l.includes('んだったら') && l.includes('【＿＿＿】')));
  check('🟠 answer is the mate', sk.answer === 'なきゃ');
  check('🟠 back bolds both parts', sk.backLines[0].includes('**んだったら**') && sk.backLines[0].includes('**なきゃ**'));
  check('🟠 front never leaks the mate', !sk.frontLines.join('\n').includes('なきゃ') || sk.frontLines.join('\n').includes('【＿＿＿】'));

  // 🟡 serifu: audio-first when yt clip exists, answer never on front
  const se = RC.buildReviewCard(mk('serifu', {}, [ytAtt('と言えるものですね', true)], 'と言えるもの'));
  check('🟡 wantsAudio when yt+timestamp', se.wantsAudio === true);
  check('🟡 answer hidden on front (blanked)', !se.frontLines.some((l) => l.includes('と言えるもの') && !l.includes('【')));
  check('🟡 answer present on back', se.backLines.includes('と言えるもの'));

  // 🔴 discourse with gold: prior turn prompts, answer hidden
  const gold = { utterance: 'でも行ったことあるんすよ', contextBefore: ['浦下君さ、鬼に頭舐められたことある?'], contextAfter: ['え、'], act: 'CONTRASTIVE-REVEAL', edge: { kind: 'contrasts', toOffset: 1 } };
  const di = RC.buildReviewCard(mk('discourse', {}, [ytAtt('でも行ったことあるんすよ', true)], 'あるんすよ'), gold);
  check('🔴 front shows prior turn', di.frontLines.some((l) => l.includes('鬼に頭')));
  check('🔴 answer is the utterance', di.answer === gold.utterance);
  check('🔴 back shows the move + 続き', di.backLines.some((l) => l.includes('CONTRASTIVE-REVEAL')) && di.backLines.some((l) => l.includes('続き')));

  // 💠 phrase schema: produce the whole frame
  const ph = RC.buildReviewCard(mk('phrase_schema', { frame: '「○○」というところで納得している' }, [ytAtt('意味というところで納得している', false)], 'というところで納得している'));
  check('💠 answer is the frame', ph.answer === '「○○」というところで納得している');
  check('💠 soft hint (first char + length), not the raw answer', ph.frontLines.some((l) => l.includes('ヒント') && l.includes('字')));

  // 🟢 rhet: lemma + halo
  const rh = RC.buildReviewCard(mk('rhet_collocation', { lemma: '破綻', halo: 'として〜している' }, [ytAtt('として破綻している', true)], '破綻'));
  check('🟢 answer is the lemma', rh.answer === '破綻');
  check('🟢 back carries the halo', rh.backLines[0].includes('として'));

  // gloss appended everywhere
  const withGloss = RC.buildReviewCard(mk('collocation', { gloss: '因果の逆接' }, [ytAtt('材質が違えば', false)], '材質が違う'));
  check('gloss appended to back', withGloss.backLines.some((l) => l.includes('因果の逆接')));

  // reviewability
  check('skeletal with 2 parts reviewable w/o attestation', RC.isReviewable(mk('skeletal', { parts: ['a', 'b'] }, [])));
  check('no material → not reviewable', !RC.isReviewable(mk('serifu', {}, [])));
}

console.log('══ cloze hygiene ══');
{
  check('cloze hides all occurrences', RC.cloze('AとBとA', ['A']) === '【＿＿＿】とBと【＿＿＿】');
  check('cloze longest-first (no partial)', RC.cloze('東京都', ['東京', '東京都']) === '【＿＿＿】');
  check('cloze no terms → unchanged', RC.cloze('そのまま', []) === 'そのまま');
}

console.log('══ leeches: repeated lapses suspend the card ══');
{
  // lapse a review card LEECH_LAPSES times
  let s = { state: 'review', dueMs: T0, intervalDays: 10, ease: 2500, reps: 5, lapses: 0, stepIndex: 0 };
  let t = T0;
  for (let i = 0; i < S.LEECH_LAPSES; i++) {
    s = S.schedule(s, 1, t);                       // lapse
    if (i < S.LEECH_LAPSES - 1) check(`lapse ${i + 1}: not yet a leech`, !s.leech);
    s = S.schedule(s, 3, s.dueMs);                 // relearn back to review
    t = s.dueMs;
  }
  check(`lapse ${S.LEECH_LAPSES} flags leech`, s.leech === true);

  const store = new ST.SrsStore(async () => {});
  store.load({ cards: { leechy: s, healthy: { state: 'review', dueMs: T0, intervalDays: 3, ease: 2500, reps: 2, lapses: 0, stepIndex: 0 } } });
  const q = store.buildQueue(['leechy', 'healthy'], t + DAY, 5);
  check('leech excluded from queue', !q.includes('leechy') && q.includes('healthy'));
  const c = store.counts(['leechy', 'healthy'], t + DAY);
  check('counts report the leech', c.leech === 1 && c.due === 1);

  const revived = await store.reviveLeeches(['leechy', 'healthy'], t + DAY);
  check('reviveLeeches clears flag + makes due', revived === 1 && !store.stateOf('leechy').leech && S.isDue(store.stateOf('leechy'), t + DAY));
  const recovered = S.schedule({ ...store.stateOf('leechy'), state: 'review', intervalDays: 5 }, 4, t + DAY);
  check('簡単 after revive clears leech permanently', recovered.leech === false);
}

console.log(`\n${fail ? '✗' : '✓'} srs: ${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
