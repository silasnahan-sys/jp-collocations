/**
 * golden/reach.mjs — HOLDING THE REACHING (§27.0.2).
 *
 * The worked example from the donor essay is the acceptance test: the user
 * wanted **"at some point"**, found it in no dictionary, then HEARD a podcaster
 * say 「どっかのタイミングで」 and recognized it. This suite runs that arc and
 * pins the three rules that keep it honest:
 *
 *   • the machine OFFERS, never answers — every offer states a weak, skeletal
 *     reason and nothing is ever filled without the user's recognition;
 *   • a filled reach STAYS — the hole is the trace of the collision;
 *   • a rejected offer never comes back.
 *
 *   node golden/reach.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
const { transpileModule } = ts;

const HERE = dirname(fileURLToPath(import.meta.url));
const tsc = (s) => transpileModule(s, { compilerOptions: { module: 'ESNext', target: 'ES2022' } }).outputText;
const url = (j) => 'data:text/javascript;base64,' + Buffer.from(j).toString('base64');
// reach.ts imports the ONE frame key space (frames.ts) so a want and the
// dictionary's reach-for query agree about what shape is being circled.
const framesUrl = url(tsc(readFileSync(join(HERE, '..', 'src', 'dictionary', 'frames.ts'), 'utf8')));
const js = tsc(readFileSync(join(HERE, '..', 'src', 'notes', 'reach.ts'), 'utf8'))
  .replace(/from ['"]\.\.\/dictionary\/frames\.ts['"]/g, `from '${framesUrl}'`);
const R = await import(url(js));

let fail = 0, n = 0;
const ok = (cond, msg, extra = '') => {
  n++;
  if (!cond) { fail++; console.log(`  ✗ ${msg} ${extra}`); } else console.log(`  ✓ ${msg}`);
};

console.log('══ a want with no phrase yet is a first-class object ══');
{
  const r = R.openReach('at some point', 1000, 'そのうち、いつか — でも「いつか」ほど遠くない');
  ok(r.id.startsWith('reach-'), 'has a stable id', `(${r.id})`);
  ok(R.openReach('at some point', 1000).id === r.id, 'the id is deterministic');
  ok(R.openReach('at some point', 2000).id !== r.id, 'a different moment is a different reach');
  ok(R.isOpen(r), 'a fresh reach is open');
  ok(r.offers.length === 0, 'and empty — the plugin holds the HOLE, not an answer');
  let threw = false;
  try { R.openReach('   ', 1); } catch { threw = true; }
  ok(threw, 'an empty want is refused (a reach without a want is nothing)');
}

console.log('\n══ THE DONOR-ESSAY ARC: want first, hearing later, collision ══');
{
  let r = R.openReach('at some point', 1000, 'いつか');
  // the attested stream: a podcast turn arrives, months later
  const incoming = [
    { surface: 'まあどっかのタイミングで話そうかな', at: 5000,
      source: { file: 'Transcripts/podcast.md', tStartSec: 742, medium: 'yt' } },
    { surface: '全然関係ない発話です', at: 5001 },
  ];
  // With no shared token and no frame, the ONLY honest mechanism is
  // juxtaposition — §27.0.2's "set the scenes side by side and let the flash
  // happen". The machine cannot know this is the one.
  const made = R.collide([r], incoming, { juxtaposeLimit: 2 });
  ok(made.length === 2, 'both arrivals are offered by juxtaposition', `(${made.length})`);
  ok(made.every((m) => m.offer.reason === 'juxtapose'), 'and are honestly labelled as such');
  ok(made.every((m) => !m.offer.verdict), 'NOTHING arrives pre-judged');

  r = R.applyOffers([r], made)[0];
  ok(r.offers.length === 2, 'offers attach to the reach');
  ok(r.offers[0].source?.tStartSec === 742, 'the door back survives (§28 S2)');
  ok(R.isOpen(r), 'still open — an offer is not a fill');

  // the flash: the user recognizes it. Only they can do this.
  r = R.recognize(r, 0, 6000);
  ok(r.filled?.surface === 'まあどっかのタイミングで話そうかな', 'felt recognition fills it');
  ok(r.offers[0].verdict === 'yes', 'the recognized offer is marked');
  ok(!R.isOpen(r), 'a filled reach is no longer open');
  ok(r.offers.length === 2 && r.want === 'at some point',
    'the HOLE STAYS — the want and the rejected company are the trace of the collision');
}

console.log('\n══ the machine offers, and says why in words that never mean ══');
{
  const r = R.openReach('to fall apart', 3000, '破綻');
  const made = R.collide([r], [
    { surface: '関係が破綻していた', at: 4000 },
    { surface: '猫が寝ている', at: 4001 },
  ]);
  ok(made.length === 1, 'only the token-sharing arrival is offered', `(${made.length})`);
  ok(made[0].offer.reason === 'token', 'labelled as a WRITING match');
  ok(/表記/.test(made[0].offer.why), 'and its why says so explicitly, not "this means that"',
    `(${made[0].offer.why})`);
  ok(!/=|means|意味は/.test(made[0].offer.why), 'no offer ever asserts an equivalence');
}

console.log('\n══ a rejected offer never comes back ══');
{
  let r = R.openReach('to fall apart', 3000, '破綻');
  const item = { surface: '関係が破綻していた', at: 4000 };
  r = R.applyOffers([r], R.collide([r], [item]))[0];
  ok(r.offers.length === 1, 'offered once');
  r = R.reject(r, 0);
  ok(r.offers[0].verdict === 'no', 'marked as not-it');
  const again = R.collide([r], [item]);
  ok(again.length === 0, 're-running the watcher does NOT offer it again');
  ok(R.isOpen(r), 'and the reach is still open — rejecting an offer is not giving up');
}

console.log('\n══ closed reaches are inert ══');
{
  const filled = R.recognize(
    R.applyOffers([R.openReach('w', 1)], R.collide([R.openReach('w', 1)], [{ surface: 'w-ish', at: 2 }], { juxtaposeLimit: 1 }))[0],
    0, 3);
  ok(R.collide([filled], [{ surface: 'another', at: 9 }], { juxtaposeLimit: 5 }).length === 0,
    'a filled reach receives no further offers');
  const gone = R.abandon(R.openReach('w2', 1), 5);
  ok(!R.isOpen(gone), 'an abandoned reach is closed');
  ok(R.collide([gone], [{ surface: 'x', at: 9 }], { juxtaposeLimit: 5 }).length === 0,
    'and receives none either');
}

console.log('\n══ the FRAME offer fires at all (AUDIT-PARTS §7) ══');
// This reason was unreachable in production on two counts: the only caller
// never supplied `frameKey`, and the test was `frameKey.includes(gloss)` —
// a gloss is prose ("that feeling when…"), a frame key is a slotted Japanese
// shape, so it was false in every real case. Untested branch, dead branch.
{
  const at = 1_000;
  // A want written WITH its shape in it — which is how a hole usually arrives.
  // Deliberately a case where NO token is shared: the arriving phrase realizes
  // the shape without repeating any of its words, which is exactly the case the
  // token branch cannot reach and the frame branch exists for.
  const r = R.openReach('〜が有効な反論', at, 'the move that actually lands');
  const made = R.collide([r], [{ surface: 'それは決定打になる指摘だ', frameKey: '～が有効な反論', at }]);
  ok(made.length === 1, 'a want circling a shape meets a phrase realizing it', JSON.stringify(made));
  ok(made[0]?.offer.reason === 'frame', 'and the reason is `frame`', made[0]?.offer.reason);
  ok(/型/.test(made[0]?.offer.why ?? ''), 'the why names the SHAPE, never a meaning', made[0]?.offer.why);
  ok(!/=|means|意味です/.test(made[0]?.offer.why ?? ''), 'and still asserts no equivalence');

  // A want with no shape in it has no frame to have been circling.
  const plain = R.openReach('that feeling when you give up', at);
  const none = R.collide([plain], [{ surface: '諦めがつく', frameKey: '～のタイミングで', at }]);
  ok(none.length === 0, 'a shapeless want gets NO frame offer', JSON.stringify(none));

  // A bare slot would otherwise match everything that arrives.
  const bare = R.openReach('～', at);
  const flood = R.collide([bare], [{ surface: '無関係な句', frameKey: '～のタイミングで', at }]);
  ok(flood.length === 0, 'a bare slot is not a frame — no flood of offers', JSON.stringify(flood));

  // Token still wins when both could fire: it is the more specific evidence.
  const both = R.openReach('タイミング', at);
  const t = R.collide([both], [{ surface: 'どっかのタイミングで', frameKey: '～のタイミングで', at }]);
  ok(t[0]?.offer.reason === 'token', 'a token match outranks a frame match', t[0]?.offer.reason);
}

console.log('\n══ juxtaposition is BOUNDED (a wall of noise is not juxtaposition) ══');
{
  const r = R.openReach('something', 1);
  const many = Array.from({ length: 50 }, (_, i) => ({ surface: `x${i}`, at: 10 + i }));
  ok(R.collide([r], many, { juxtaposeLimit: 3 }).length === 3, 'the limit holds', '');
  ok(R.collide([r], many).length === 0,
    'and with no limit set, juxtaposition is OFF by default — silence over noise');
}

console.log('\n══ tokens justify offers; they never carry meaning ══');
{
  const t = R.wantTokens('the feeling when something is about to break');
  ok(!t.includes('the') && !t.includes('is') && !t.includes('when'), 'stopwords dropped');
  ok(t.includes('feeling') && t.includes('break'), 'content words kept', `(${t.join(',')})`);
  ok(R.wantTokens('').length === 0, 'empty want → no tokens');
}

console.log('\n══ stats for a header line ══');
{
  const a = R.openReach('a', 1);
  let b = R.openReach('b', 2);
  b = R.applyOffers([b], R.collide([b], [{ surface: 'b-ish', at: 3 }], { juxtaposeLimit: 1 }))[0];
  const c = R.recognize(
    R.applyOffers([R.openReach('c', 4)], R.collide([R.openReach('c', 4)], [{ surface: 'c!', at: 5 }], { juxtaposeLimit: 1 }))[0],
    0, 6);
  const s = R.reachStats([a, b, c]);
  ok(s.open === 2 && s.filled === 1, 'open/filled counted', JSON.stringify(s));
  ok(s.waiting === 1, 'waiting = open reaches holding an unjudged offer', JSON.stringify(s));
}

console.log(`\n${fail ? '✗' : '✓'} reach: ${n - fail}/${n} checks passed`);
process.exit(fail ? 1 : 0);
