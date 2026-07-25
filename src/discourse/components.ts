/**
 * components.ts — micro-component detectors for the discourse stack
 * (DESIGN §23). PURE — golden-tested in golden/components.mjs against the
 * user's REAL ゆる哲学ラジオ failure cases.
 *
 * The skeleton principle applied at its true grain: the parser is only
 * asked questions surface shape can answer. It does NOT name moves, read
 * tone, or classify — it detects COMPONENTS with high precision:
 *
 *   echo      — a bare fragment re-uttering a word from the immediately
 *               preceding clause (感謝した方がいい。→「感謝。」): the
 *               lexical retake/pivot. WHAT it does (savoring, distilling,
 *               mocking) is layer-4 human territory; THAT it echoes is shape.
 *   aizuchi   — pure interjection sentence (うん。ほう。なるほど。)
 *   reaction  — a short assessment fragment (そこまで言う。すごいな。):
 *               listener-shaped, hence a turn-flip suggestion
 *   return    — the sentence AFTER a reaction cluster that resumes
 *               exposition: suggests the floor RETURNS to the prior speaker
 *               (the CA adjacency logic: reactions belong to the listener,
 *               and the floor comes back)
 *
 * Suggestions only — every one lands as a faint mark for tap-ratification
 * in 談話モード; ratifications are layer-2 gold.
 */

import { normalizeJapanese } from '../utils/japanese.ts';

const norm = (s: string): string => normalizeJapanese(s).replace(/[\s、。！？!?…]/g, '');

/** Split a caption line / turn into sentence units (the real grain of
 *  turn-taking — a single caption line often holds a reaction AND the
 *  next speaker's resumption). */
export function sentenceUnits(text: string): string[] {
  return text.split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean);
}

/** Same units, each with its char offset in the RAW text — so a tapped unit
 *  pill can become a (line,char) turn boundary. 1:1 with sentenceUnits(). */
export function sentenceUnitSpans(text: string): Array<{ unit: string; start: number }> {
  const out: Array<{ unit: string; start: number }> = [];
  let offset = 0;
  for (const piece of text.split(/(?<=[。！？!?])/)) {
    const unit = piece.trim();
    if (unit) out.push({ unit, start: offset + (piece.length - piece.trimStart().length) });
    offset += piece.length;
  }
  return out;
}

const AIZUCHI_RE = /^(うん|ええ|はい|ほう|へえ|あー|おお|なるほど|まあ|ふーん|そうそう|たしかに|それな)$/;
/** assessment-fragment shapes: listener-voiced evaluations of what was just said. */
const REACTION_RES = [
  /^そこまで(言う|やる|する)$/,
  /^急に(何|どうした)?$/,
  /^(すご|やば|えぐ|ずる)[いなっ]*$/,
  /^(いや)?(まじ|ほんと|本当)(で|か|に)?(すか)?$/,
  /^言い過ぎ(でしょ|だろ)?$/,
  /^(何|なん)(それ|の話|でよ)$/,
];

export type ComponentKind = 'echo' | 'aizuchi' | 'reaction' | 'return' | 'connective' | 'quotative';

export interface ComponentMark {
  /** index into the sentence-unit list. */
  unit: number;
  kind: ComponentKind;
  /** echo: the re-uttered word and where it came from. */
  echoed?: string;
  /** connective: the connective word; quotative: the quoted material/marker. */
  evidence?: string;
  /** reaction/aizuchi suggest the OTHER speaker; return suggests the floor
   *  going back to the pre-reaction speaker. */
  speakerFlip: boolean;
}

/** Is this bare fragment an echo of the previous clause? Shape only: short,
 *  predicate-less, and its content occurs verbatim in what came before. */
export function detectEcho(prevClause: string, fragment: string): string | null {
  const frag = norm(fragment);
  if (!frag || frag.length < 2 || frag.length > 8) return null;
  if (AIZUCHI_RE.test(frag)) return null;                 // aizuchi is its own thing
  const prev = norm(prevClause);
  if (!prev || prev === frag) return null;
  return prev.includes(frag) ? frag : null;
}

export function isAizuchi(unit: string): boolean {
  return AIZUCHI_RE.test(norm(unit));
}

export function isReactionShape(unit: string): boolean {
  const u = norm(unit);
  if (!u || u.length > 12) return false;
  return REACTION_RES.some((re) => re.test(u));
}

/** Sentence-initial connectives. Precision-first: only marked when followed
 *  by an explicit pause (、) or standing alone as a bare fragment — a
 *  connective buried in flow is not a discourse-structural component we can
 *  claim from shape alone. */
const CONNECTIVES = [
  'でも', 'だから', 'つまり', '要するに', 'ということは', 'それで', 'じゃあ',
  'とはいえ', 'しかも', '逆に', 'ちなみに', 'むしろ', 'なので', 'ってことは',
];

export function detectConnective(unit: string): string | null {
  const u = unit.trim();
  for (const c of CONNECTIVES) {
    if (u === c || u === c + '。' || u.startsWith(c + '、')) return c;
  }
  return null;
}

/** Quotative frame: bracketed quotes, or って/と + a verb of saying/thinking.
 *  Tight on purpose — bare という (nominalizer) never fires. */
const QUOTATIVE_RE = /(って|と)(言っ|言う|言い|思っ|思う|思い|聞い|書い)/;

export function detectQuotative(unit: string): string | null {
  const bracket = unit.match(/「([^」]+)」/);
  if (bracket) return bracket[1];
  const m = unit.match(QUOTATIVE_RE);
  return m ? m[0] : null;
}

/**
 * Analyze one line/turn (with the previous unit of context): sentence units
 * → component marks, including the floor-return suggestion after a reaction
 * cluster. This is the machine side of the user's two real failure cases:
 *   「…感謝した方がいい。感謝。日頃の感謝が…」 → unit 1 = echo(感謝)
 *   「うん。そこまで言う。急にゆる歴史ラジオ回と…」 →
 *     units 0-1 = aizuchi+reaction (flip to listener), unit 2 = return
 */
export function analyzeUnits(prevText: string, text: string): ComponentMark[] {
  const units = sentenceUnits(text);
  const out: ComponentMark[] = [];
  let inReactionCluster = false;
  for (let i = 0; i < units.length; i++) {
    const prev = i === 0 ? prevText : units[i - 1];
    if (isAizuchi(units[i])) {
      out.push({ unit: i, kind: 'aizuchi', speakerFlip: true });
      inReactionCluster = true;
      continue;
    }
    if (isReactionShape(units[i])) {
      out.push({ unit: i, kind: 'reaction', speakerFlip: true });
      inReactionCluster = true;
      continue;
    }
    const echoed = detectEcho(prev, units[i]);
    if (echoed) {
      out.push({ unit: i, kind: 'echo', echoed, speakerFlip: false });
      inReactionCluster = false;
      continue;
    }
    if (inReactionCluster) {
      // exposition resumes after reactions → the floor goes back
      out.push({ unit: i, kind: 'return', speakerFlip: true });
      inReactionCluster = false;
      continue;
    }
    // annotation-only components: no speaker implication, ratify-only pills
    const conn = detectConnective(units[i]);
    if (conn) {
      out.push({ unit: i, kind: 'connective', evidence: conn, speakerFlip: false });
      continue;
    }
    const quot = detectQuotative(units[i]);
    if (quot) {
      out.push({ unit: i, kind: 'quotative', evidence: quot, speakerFlip: false });
    }
  }
  return out;
}
