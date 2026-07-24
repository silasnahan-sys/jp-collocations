// src/discourse/calculus/scoreboard.mjs
// =====================================================================
// THE COMMON-GROUND SCOREBOARD  +  CLOSED UPDATE ALGEBRA  +  REDUCER (v2)
// ---------------------------------------------------------------------
// PURE. No Obsidian, no network, no LLM. Golden-tested via
//   node golden/scoreboard.mjs   (and golden/calculus-corpus.mjs at scale)
//
// THEORY (full spec: DISCOURSE-CALCULUS.md, incl. the three Amendments).
// An utterance's *discourse* meaning IS its effect on the common ground.
//
//   • STATE   ⟨ CG, Table, DC_speaker, QUD-stack, Projected ⟩ + settled/
//             lapsed archives (Amendment III) + unresolved ledger.
//   • ALGEBRA a CLOSED set of primitive update operations — the ONLY ways
//             the state changes by a SPEAKER MOVE. Board DYNAMICS (lapse,
//             tacit acceptance) are not moves and log separately.
//   • ENGINE  reduce(turns, recognize) folds a transcript into the
//             trajectory the board traces. Amendment I: the atom is the
//             SPAN EVENT, folded in surface order — an utterance is a
//             mini-trajectory, not a bag of features.
//
// The op set is DEDUCED, never learned; corpora TEST it. A mistake here
// corrects a RULE. Recognition (moves.mjs) is the replaceable edge.
// =====================================================================

/** The closed primitive set (speaker moves). Changing it is constitutional. */
export const PRIMITIVES = Object.freeze([
  // placement
  'PROPOSE', 'ASSERT_AS_DERIVED', 'CONSCRIPT', 'PREFACE_CONTESTABLE',
  // relations over existing propositions
  'RELATE_SUPPORT', 'RELATE_CONTRAST', 'SUBSTITUTE', 'RETRACT_OWN',
  'REJECT', 'GRANT', 'RATIFY',
  'ACKNOWLEDGE', // Amendment II: continuer uptake (Clark) — attention/floor-yield, NO CG entry
  // stance / scope control
  'DENY_COMMITMENT', 'RE_TYPE', 'ADJUST_FORCE', 'PROJECT_CONSEQUENCE',
  // question management
  'RAISE_QUD', 'ANSWER_QUD', 'SHELVE_QUD', 'RESUME_QUD',
]);

// Settlement windows (Amendment III). Structural constants, not weights:
// they bound how long an item stays LIVE without interaction, so registers
// model attention, not archive. Tune constitutionally, not per-transcript.
export const WINDOWS = Object.freeze({
  TABLE_LAPSE: 8,     // unaddressed proposal drops out of live Table after N turns
  CONSCRIPT_TACIT: 6, // unchallenged conscription slides into CG (Stalnaker default acceptance)
  PROJECT_LAPSE: 8,   // unfenced/unratified projected inference decays
  QUD_LAPSE: 12,      // unanswered question stops organizing relevance
  BIND_DENY: 3,       // a fence may bind at most this many turns back; farther = UNRESOLVED
  BIND_RETYPE: 6,     // re-type reach-back for own props
});

// ---------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------
export function makeBoard() {
  return {
    seq: 0, turnIdx: 0,
    props: new Map(),   // id → { id, gloss, owner, status, force, flags, turnIdx, lastActive }
    cg: [],             // prop ids mutually accepted
    table: [],          // live proposals [{ id, owner, force, flags, turnIdx, lastActive, acks }]
    dc: {},             // speaker → [prop ids] public commitments
    qud: [],            // active questions [{ id, gloss, owner, turnIdx }]
    shelved: [],        // parked QUDs (persist until resumed — parked means parked)
    answered: [],       // settled QUDs
    lapsedQud: [],
    projected: [],      // attributable-not-grounded [{ id, gloss, owner, turnIdx, kind }]
    lapsed: [],         // table items that fell out of live attention
    unresolved: [],     // moves whose antecedent could not be bound in-window
    log: [],            // speaker moves: { tSec, speaker, prim, ref, note }
    dynamics: [],       // board dynamics (LAPSE / TACIT_CG) — not speaker moves
    turns: [],          // per-utterance snapshots
  };
}

function newProp(board, gloss, owner, force = 'assert', flags = {}) {
  const id = ++board.seq;
  const g = String(gloss || '').replace(/\s+/g, ' ').trim().slice(0, 48);
  const p = { id, gloss: g, owner, status: 'literal', force, flags: { ...flags },
              turnIdx: board.turnIdx, lastActive: board.turnIdx };
  board.props.set(id, p);
  (board.dc[owner] ??= []).push(id);
  return p;
}

const glossOf = (board, id) => board.props.get(id)?.gloss ?? `#${id}`;
const rec = (board, tSec, speaker, prim, ref = '', note = '') =>
  board.log.push({ tSec, speaker, prim, ref, note });
const dyn = (board, tSec, kind, ref = '') => board.dynamics.push({ tSec, kind, ref });

function mostRecentTable(board, speaker, who = 'any') {
  for (let i = board.table.length - 1; i >= 0; i--) {
    const it = board.table[i];
    if (who === 'other' && it.owner === speaker) continue;
    if (who === 'self' && it.owner !== speaker) continue;
    return it;
  }
  return null;
}
const removeFromTable = (board, item) => {
  const i = board.table.indexOf(item);
  if (i >= 0) board.table.splice(i, 1);
};
const dropProjected = (board, id) => {
  const i = board.projected.findIndex(x => x.id === id);
  if (i >= 0) board.projected.splice(i, 1);
};
const toCG = (board, id) => { if (!board.cg.includes(id)) board.cg.push(id); };
const tableItem = (p) => ({ id: p.id, owner: p.owner, force: p.force, flags: p.flags,
                            turnIdx: p.turnIdx, lastActive: p.turnIdx, acks: 0 });

// ---------------------------------------------------------------------
// PRIMITIVE OPERATIONS (the ONLY speaker-move mutators)
// ---------------------------------------------------------------------
const P = {
  PROPOSE(board, s, sp, p) { board.table.push(tableItem(p)); return p.gloss; },

  ASSERT_AS_DERIVED(board, s, sp, p) {
    p.flags.derived = true;
    board.table.push(tableItem(p));
    rec(board, s, sp, 'RELATE_SUPPORT', 'CG→' + p.gloss);
    return p.gloss;
  },

  CONSCRIPT(board, s, sp, p) {
    p.flags.conscripted = true;
    board.table.push(tableItem(p));
    board.projected.push({ id: p.id, gloss: p.gloss, owner: sp, turnIdx: board.turnIdx, kind: 'conscription' });
    return p.gloss;
  },

  PREFACE_CONTESTABLE(board, s, sp, p) {
    p.force = 'low'; p.flags.defended = true;
    board.table.push(tableItem(p));
    return p.gloss;
  },

  GRANT(board, s, sp) {
    // Amendment V: no fallback to own props — a speaker cannot unilaterally
    // move their own proposal into CG (that is what conscription+uptake is
    // for). The old 'any' fallback let a bare でも grant the speaker's own
    // claim to themselves.
    const q = mostRecentTable(board, sp, 'other');
    if (!q) return '(nothing to grant)';
    removeFromTable(board, q);
    toCG(board, q.id);
    dropProjected(board, q.id);
    return glossOf(board, q.id);
  },

  // Amendment V: the declared-but-never-fired relation, made real. A bare
  // initial adversative (でも/けど/しかし) CONTESTS the other's live prop:
  // it stays on the Table (still arguable) but is marked, and a contested
  // conscription may NOT slide into CG tacitly (settle() checks the flag) —
  // Stalnaker default acceptance holds only absent objection.
  RELATE_CONTRAST(board, s, sp) {
    const q = mostRecentTable(board, sp, 'other');
    if (!q) return '(nothing to contest)';
    q.lastActive = board.turnIdx;
    const pr = board.props.get(q.id);
    if (pr) pr.flags.contested = true;
    return glossOf(board, q.id);
  },

  REJECT(board, s, sp) {
    const q = mostRecentTable(board, sp, 'other');
    if (!q) return '(nothing to reject)';
    removeFromTable(board, q);
    board.props.get(q.id).flags.rejected = true;
    dropProjected(board, q.id);
    return glossOf(board, q.id);
  },

  RATIFY(board, s, sp) {
    const q = mostRecentTable(board, sp, 'other');
    if (!q) return '(nothing to ratify)';
    removeFromTable(board, q);
    toCG(board, q.id);
    dropProjected(board, q.id);
    return glossOf(board, q.id);
  },

  // Amendment II: the continuer. Keeps the prop ALIVE and attended; enters
  // nothing into CG. (うん is attention, not agreement.)
  ACKNOWLEDGE(board, s, sp) {
    const q = mostRecentTable(board, sp, 'other');
    if (!q) return '(nothing to acknowledge)';
    q.acks++; q.lastActive = board.turnIdx;
    return glossOf(board, q.id);
  },

  SUBSTITUTE(board, s, sp, p) {
    const prev = board.table.filter(it => it.owner === sp && it.id !== p.id).pop();
    if (prev) { p.flags.reformulates = prev.id; prev.lastActive = board.turnIdx;
                return glossOf(board, prev.id) + ' ≈ ' + p.gloss; }
    return p.gloss;
  },

  RETRACT_OWN(board, s, sp, p) {
    const prev = board.table.filter(it => it.owner === sp && (!p || it.id !== p.id)).pop();
    if (prev) {
      removeFromTable(board, prev);
      board.props.get(prev.id).flags.retracted = true;
      dropProjected(board, prev.id);
      return glossOf(board, prev.id) + (p ? ' ⇒ ' + p.gloss : ' (withdrawn)');
    }
    return p ? p.gloss : '(nothing to retract)';
  },

  DENY_COMMITMENT(board, s, sp) {
    // Fence the most recent inference attributed to the speaker — but only
    // within the binding window. Beyond it, the antecedent is skeletally
    // undeterminable → UNRESOLVED (first-class, not a recency guess).
    for (let i = board.projected.length - 1; i >= 0; i--) {
      const it = board.projected[i];
      if (it.owner !== sp) continue;
      if (board.turnIdx - it.turnIdx > WINDOWS.BIND_DENY) break;
      board.projected.splice(i, 1);
      const pr = board.props.get(it.id);
      if (pr) pr.flags.fenced = true;
      const d = board.dc[sp]; if (d) { const k = d.indexOf(it.id); if (k >= 0) d.splice(k, 1); }
      return it.gloss;
    }
    board.unresolved.push({ tSec: s, speaker: sp, wanted: 'DENY_COMMITMENT',
                            reason: 'no self-attributed inference within window' });
    return '(unresolved fence)';
  },

  RE_TYPE(board, s, sp, p) {
    // Recharacterizes a PRIOR claim — never the utterance it arrives in.
    const cand = board.table.filter(it => it.owner === sp && (!p || it.id !== p.id) &&
      it.turnIdx < board.turnIdx &&
      board.turnIdx - it.turnIdx <= WINDOWS.BIND_RETYPE).pop();
    const pr = cand ? board.props.get(cand.id) : lastOwnProp(board, sp, WINDOWS.BIND_RETYPE, p?.id);
    if (pr) { pr.status = 'heuristic'; return pr.gloss + ' (literal→heuristic)'; }
    board.unresolved.push({ tSec: s, speaker: sp, wanted: 'RE_TYPE',
                            reason: 'no own prop within window' });
    return '(unresolved re-type)';
  },

  ADJUST_FORCE(board, s, sp, p, level = 'low') { p.force = level; return `${p.gloss} → ${level}`; },

  PROJECT_CONSEQUENCE(board, s, sp, p) {
    p.flags.consequence = true;
    board.projected.push({ id: p.id, gloss: p.gloss, owner: sp, turnIdx: board.turnIdx, kind: 'consequence' });
    return p.gloss;
  },

  RAISE_QUD(board, s, sp, p) {
    board.qud.push({ id: p.id, gloss: p.gloss, owner: sp, turnIdx: board.turnIdx });
    return p.gloss;
  },
  ANSWER_QUD(board, s, sp, p) {
    // Settles the top question when a NON-asker substantively addresses it
    // (Amendment III: answering POPS — the register models open questions).
    const top = board.qud[board.qud.length - 1];
    if (!top) return '(no open QUD)';
    p.flags.answers = top.id;
    if (top.owner !== sp) { board.qud.pop(); board.answered.push(top); }
    return top.gloss;
  },
  SHELVE_QUD(board, s, sp, p) {
    const top = board.qud.pop();
    if (top) { board.shelved.push(top); return top.gloss; }
    // Anaphoric park: 一旦置いておいて names its own issue. With no typed
    // question open (common on unpunctuated ASR), park the utterance's
    // issue itself — skeletal, synthesized, and honest about it.
    if (p) {
      board.shelved.push({ id: p.id, gloss: p.gloss, owner: sp, turnIdx: board.turnIdx, synthesized: true });
      return 'parked: ' + p.gloss;
    }
    return '(no QUD to shelve)';
  },
  RESUME_QUD(board, s, sp) {
    const q = board.shelved.pop();
    if (q) { q.turnIdx = board.turnIdx; board.qud.push(q); return q.gloss; }
    return '(no shelved QUD)';
  },
};

function lastOwnProp(board, sp, window, exclId = null) {
  const ids = board.dc[sp]; if (!ids) return null;
  for (let i = ids.length - 1; i >= 0; i--) {
    const pr = board.props.get(ids[i]);
    if (!pr || pr.id === exclId || pr.turnIdx >= board.turnIdx) continue;
    if (board.turnIdx - pr.turnIdx <= window && !pr.flags.retracted) return pr;
  }
  return null;
}

// ---------------------------------------------------------------------
// AFFORDANCES — which primitives' preconditions are satisfiable NOW.
// This is the board's product for a PRODUCTION tool: the live choice-set
// (the 〔ctx〕 production-condition for 🔴), and the basis of the
// next-move-prediction drill.
// ---------------------------------------------------------------------
export function affordances(board, speaker) {
  const out = [];
  const add = (prim, why) => out.push({ prim, why });
  add('PROPOSE', 'always available');
  add('PREFACE_CONTESTABLE', 'always available');
  add('CONSCRIPT', 'always available (demands uptake)');
  add('RAISE_QUD', 'always available');
  if (board.cg.length) add('ASSERT_AS_DERIVED', `CG has ${board.cg.length} props to derive from`);
  const oth = mostRecentTable(board, speaker, 'other');
  if (oth) {
    add('GRANT', `live other-prop: ${glossOf(board, oth.id)}`);
    add('REJECT', `live other-prop: ${glossOf(board, oth.id)}`);
    add('RATIFY', `live other-prop: ${glossOf(board, oth.id)}`);
    add('RELATE_CONTRAST', `live other-prop: ${glossOf(board, oth.id)}`);
    add('ACKNOWLEDGE', 'other holds the floor');
  }
  const own = mostRecentTable(board, speaker, 'self');
  if (own) {
    add('RETRACT_OWN', `own live prop: ${glossOf(board, own.id)}`);
    add('SUBSTITUTE', `own live prop: ${glossOf(board, own.id)}`);
    add('PROJECT_CONSEQUENCE', `own live prop: ${glossOf(board, own.id)}`);
    if (board.turnIdx - own.turnIdx <= WINDOWS.BIND_RETYPE)
      add('RE_TYPE', `own prop in window: ${glossOf(board, own.id)}`);
  }
  if (board.projected.some(x => x.owner === speaker && board.turnIdx - x.turnIdx <= WINDOWS.BIND_DENY))
    add('DENY_COMMITMENT', 'a self-attributed inference is live');
  if (board.qud.length) { add('ANSWER_QUD', `open: ${board.qud[board.qud.length - 1].gloss}`); add('SHELVE_QUD', 'a question is open'); }
  if (board.shelved.length) add('RESUME_QUD', `parked: ${board.shelved[board.shelved.length - 1].gloss}`);
  return out;
}

// ---------------------------------------------------------------------
// APPLY ONE TURN — fold span events IN SURFACE ORDER (Amendment I),
// then grounding events, then settlement dynamics (Amendments II–III).
// `r` = recognizeEvents(text); `turn.grounding` = lifted backchannels.
// ---------------------------------------------------------------------
function applyTurn(board, turn, r) {
  const { speaker: sp, text: s, tSec } = turn;
  board.turnIdx++;
  const prims = [];
  const fire = (prim, arg) => {
    const ref = P[prim](board, tSec, sp, arg?.p, arg?.level);
    prims.push(prim); rec(board, tSec, sp, prim, ref);
  };

  // Backchannel-only turn that reached the reducer un-lifted → continuer.
  if (r.backchannel) {
    fire('ACKNOWLEDGE');
    applyGrounding(board, turn, prims);
    settle(board, tSec);
    return snap(board, turn, r, prims);
  }

  let focal = null;
  let pendingRepair = false, pendingSubstitute = false, pendingProject = false;
  const placeKind = { 'place:conscript': 'CONSCRIPT', 'place:derived': 'ASSERT_AS_DERIVED', 'place:preface': 'PREFACE_CONTESTABLE' };

  const place = (prim) => {
    focal = newProp(board, s, sp, r.force);
    if (board.qud.length) fire('ANSWER_QUD', { p: focal });
    fire(prim, { p: focal });
    if (r.force !== 'assert') fire('ADJUST_FORCE', { p: focal, level: r.force });
    if (pendingSubstitute) { fire('SUBSTITUTE', { p: focal }); pendingSubstitute = false; }
    if (pendingRepair) { fire('RETRACT_OWN', { p: focal }); pendingRepair = false; }
    if (pendingProject) { fire('PROJECT_CONSEQUENCE', { p: focal }); pendingProject = false; }
  };

  for (const ev of r.events) {
    switch (ev.kind) {
      case 'shelve': fire('SHELVE_QUD', { p: focal ?? newProp(board, s, sp, 'assert', { issue: true }) }); break;
      case 'resume': fire('RESUME_QUD'); break;
      case 'uptake': fire('RATIFY'); break;
      case 'reject': fire('REJECT'); break;
      case 'concede': fire('GRANT'); break;
      case 'contrast': fire('RELATE_CONTRAST'); break;
      case 'repair': if (focal) fire('RETRACT_OWN', { p: focal }); else pendingRepair = true; break;
      case 'substitute': if (focal) fire('SUBSTITUTE', { p: focal }); else pendingSubstitute = true; break;
      case 'deny': fire('DENY_COMMITMENT'); break;
      case 'retype': fire('RE_TYPE', { p: focal }); break;
      case 'project': if (focal) fire('PROJECT_CONSEQUENCE', { p: focal }); else pendingProject = true; break;
      case 'question':
        if (!focal) { focal = newProp(board, s, sp, 'assert', { question: true }); fire('RAISE_QUD', { p: focal }); }
        break;
      default:
        if (placeKind[ev.kind] && !focal) place(placeKind[ev.kind]);
        break; // contrast-medial / agree-medial: intra-flow, no board move
    }
  }

  // Default placement: substantive content with no explicit placement op.
  if (!focal && !r.isQuestion && !r.bareFence && substantive(s)) place('PROPOSE');

  applyGrounding(board, turn, prims);
  settle(board, tSec);
  return snap(board, turn, r, prims);
}

const substantive = (t) => t.replace(/[、。．，,.\s「」『』！!？?ー~〜…]/g, '').length > 6;

// Grounding events (lifted backchannels) — Amendment II.
// 'accept' → RATIFY. 'ack' → ACKNOWLEDGE, EXCEPT on a conscripted prop:
// the speaker DEMANDED uptake (じゃん/でしょ) and received assent-shaped
// signal → tacit ratification (Stalnaker default acceptance, made honest).
function applyGrounding(board, turn, prims) {
  for (const g of turn.grounding ?? []) {
    const by = g.by ?? '(listener)';
    const target = mostRecentTable(board, by, 'other');
    if (!target) continue;
    const conscripted = !!target.flags.conscripted;
    const via = `via「${String(g.text ?? '').trim().slice(0, 12)}」`;
    if (g.grade === 'accept' || (g.grade === 'ack' && conscripted)) {
      removeFromTable(board, target);
      toCG(board, target.id);
      dropProjected(board, target.id);
      const note = g.grade === 'ack' ? `tacit (conscription + continuer) ${via}` : via;
      rec(board, g.tSec, by, 'RATIFY', glossOf(board, target.id), note);
      prims.push('RATIFY');
    } else {
      target.acks++; target.lastActive = board.turnIdx;
      rec(board, g.tSec, by, 'ACKNOWLEDGE', glossOf(board, target.id), via);
      prims.push('ACKNOWLEDGE');
    }
  }
}

// Settlement dynamics — Amendment III. NOT speaker moves: logged in
// board.dynamics. Registers model live attention; archives keep history.
function settle(board, tSec) {
  const now = board.turnIdx;
  for (let i = board.table.length - 1; i >= 0; i--) {
    const it = board.table[i];
    if (now - it.lastActive > WINDOWS.TABLE_LAPSE) {
      board.table.splice(i, 1);
      board.lapsed.push(it);
      dyn(board, tSec, 'LAPSE', glossOf(board, it.id));
    }
  }
  for (let i = board.projected.length - 1; i >= 0; i--) {
    const it = board.projected[i];
    const age = now - it.turnIdx;
    if (it.kind === 'conscription' && age > WINDOWS.CONSCRIPT_TACIT) {
      board.projected.splice(i, 1);
      // Amendment V: a CONTESTED conscription does not slide into CG —
      // default acceptance holds only absent objection. It lapses instead.
      if (board.props.get(it.id)?.flags.contested) {
        dyn(board, tSec, 'LAPSE', it.gloss);
      } else {
        toCG(board, it.id);
        dyn(board, tSec, 'TACIT_CG', it.gloss);
      }
    } else if (it.kind === 'consequence' && age > WINDOWS.PROJECT_LAPSE) {
      board.projected.splice(i, 1);
      dyn(board, tSec, 'LAPSE', it.gloss);
    }
  }
  for (let i = board.qud.length - 1; i >= 0; i--) {
    if (now - board.qud[i].turnIdx > WINDOWS.QUD_LAPSE) {
      const q = board.qud.splice(i, 1)[0];
      board.lapsedQud.push(q);
      dyn(board, tSec, 'LAPSE_QUD', q.gloss);
    }
  }
}

function snap(board, turn, r, prims) {
  const s = {
    tSec: turn.tSec, speaker: turn.speaker, text: turn.text,
    ops: r.ops, prims,
    cg: board.cg.length, table: board.table.length,
    projected: board.projected.map(x => x.gloss),
    qud: board.qud.map(x => x.gloss),
  };
  board.turns.push(s);
  return prims;
}

// ---------------------------------------------------------------------
// ENGINE — fold turns (from turns.mjs or hand-built) into a trajectory.
//   turns: [{ speaker, text, tSec, grounding? }]
//   recognize: (text) → span-event descriptor (moves.mjs#recognizeEvents)
// ---------------------------------------------------------------------
export function reduce(turns, recognize, onTurn) {
  const board = makeBoard();
  for (let i = 0; i < turns.length; i++) {
    applyTurn(board, turns[i], recognize(turns[i].text));
    // Optional observer for live consumers (FollowAlong board/drill): fires
    // AFTER each turn folds, i.e. with the state the NEXT mover faces.
    // Read-only by contract — the board object is live, copy what you keep.
    onTurn?.(board, turns[i], i);
  }
  return board;
}

/** Primitive-name trace, one line per utterance. */
export function traceString(board) {
  return board.turns
    .map(t => `[${fmt(t.tSec)}] ${t.speaker}: ${t.prims.join(' · ') || '—'}`)
    .join('\n');
}
function fmt(sec) {
  if (sec == null) return '--:--';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h ? `${h}:${mm}` : mm;
}
