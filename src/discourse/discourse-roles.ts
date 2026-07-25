/**
 * discourse-roles.ts — Surface-keyed assignment of fine-grained
 * {@link DiscourseRole} + strength to existing {@link DiscoursePatternDef}
 * entries.
 *
 * Why this exists:
 *   The original `pragmaticFunction` tag was a flat coarse label — `しかし`,
 *   `けど`, `が`, `ところで`, `ではなく`, `ただし` were all `'contrast'` or
 *   `'concession'`, which made the adjacency-pair rules fire on essentially
 *   any sentence pair where ANY of these surface-level markers appeared.
 *
 *   This module overlays a finer-grained classification onto the existing
 *   pattern objects without rewriting the (~1000-line) `P(...)` call list.
 *   The role is what the discourse-relation engine actually keys off when
 *   deciding whether to emit a relation.
 *
 *   Markers not in this table simply have `discourseRole` left undefined,
 *   and the engine falls back to `pragmaticFunction`.
 */

import { ALL_PATTERNS, type DiscourseRole, type DiscoursePatternDef } from './discourse-patterns';

interface RoleAssign {
  role: DiscourseRole;
  strength: 'strong' | 'medium' | 'weak';
}

/**
 * Surface → role mapping. The same surface may appear with different
 * `position` values in different pattern entries; the role applies to all
 * occurrences unless the override table below disambiguates by id.
 */
const ROLE_BY_SURFACE: Record<string, RoleAssign> = {
  // ── Strong opposition / semantic-flip ─────────────────────
  'しかし':           { role: 'opposition', strength: 'strong' },
  'でも':             { role: 'opposition', strength: 'strong' },
  'ところが':         { role: 'opposition', strength: 'strong' },
  'それなのに':       { role: 'opposition', strength: 'strong' },
  'なのに':           { role: 'opposition', strength: 'strong' },
  'のに':             { role: 'opposition', strength: 'medium' },
  'にもかかわらず':   { role: 'opposition', strength: 'strong' },
  '反対に':           { role: 'opposition', strength: 'strong' },
  '逆に':             { role: 'opposition', strength: 'medium' },
  'むしろ':           { role: 'opposition', strength: 'medium' },
  '一方で':           { role: 'opposition', strength: 'medium' },
  'それに対して':     { role: 'opposition', strength: 'strong' },
  'に対して':         { role: 'opposition', strength: 'medium' },
  '反面':             { role: 'opposition', strength: 'medium' },
  'ではなく':         { role: 'opposition', strength: 'strong' },
  'じゃなくて':       { role: 'opposition', strength: 'strong' },
  'そうじゃなくて':   { role: 'opposition', strength: 'strong' },
  'いや':             { role: 'opposition', strength: 'strong' },
  'いやいや':         { role: 'opposition', strength: 'strong' },

  // ── Weak contrast — often topic-shift / mere conjunction ──
  'が':               { role: 'weak-contrast', strength: 'weak' },
  'けど':             { role: 'weak-contrast', strength: 'weak' },
  'けれども':         { role: 'weak-contrast', strength: 'weak' },
  'ものの':           { role: 'weak-contrast', strength: 'weak' },
  'ただ':             { role: 'qualification', strength: 'medium' },
  'ただし':           { role: 'qualification', strength: 'medium' },
  'もっとも':         { role: 'qualification', strength: 'medium' },

  // ── Concession proper ─────────────────────────────────────
  '確かに':           { role: 'concession', strength: 'strong' },
  'もちろん':         { role: 'concession', strength: 'strong' },
  'そりゃ':           { role: 'concession', strength: 'medium' },
  'そりゃそうだけど': { role: 'concession', strength: 'strong' },
  '言いたいことはわかるけど': { role: 'concession', strength: 'strong' },

  // ── Cause ─────────────────────────────────────────────────
  'から':             { role: 'cause', strength: 'medium' },
  'ので':             { role: 'cause', strength: 'medium' },
  'なので':           { role: 'cause', strength: 'medium' },
  'だから':           { role: 'cause', strength: 'strong' },
  'だからさ':         { role: 'cause', strength: 'strong' },
  'だからこそ':       { role: 'cause', strength: 'strong' },
  'ですので':         { role: 'cause', strength: 'strong' },
  'なぜなら':         { role: 'cause', strength: 'strong' },
  'なぜかというと':   { role: 'cause', strength: 'strong' },
  'というのは':       { role: 'cause', strength: 'medium' },
  'おかげで':         { role: 'cause', strength: 'medium' },
  'せいで':           { role: 'cause', strength: 'medium' },
  'だって':           { role: 'cause', strength: 'medium' },
  'ものですから':     { role: 'cause', strength: 'strong' },
  'もんだから':       { role: 'cause', strength: 'strong' },
  // ── Consequence ───────────────────────────────────────────
  'そのため':         { role: 'consequence', strength: 'strong' },
  'その結果':         { role: 'consequence', strength: 'strong' },
  '従って':           { role: 'consequence', strength: 'strong' },
  'それで':           { role: 'consequence', strength: 'medium' },
  'すると':           { role: 'consequence', strength: 'medium' },
  'そうすると':       { role: 'consequence', strength: 'medium' },
  'そこで':           { role: 'consequence', strength: 'medium' },
  'じゃあ':           { role: 'consequence', strength: 'weak' },
  'じゃ':             { role: 'consequence', strength: 'weak' },
  '結局':             { role: 'summary', strength: 'strong' },

  // ── Addition / sequence ──────────────────────────────────
  'しかも':           { role: 'addition', strength: 'strong' },
  'さらに':           { role: 'addition', strength: 'strong' },
  'その上':           { role: 'addition', strength: 'strong' },
  'それに':           { role: 'addition', strength: 'medium' },
  '加えて':           { role: 'addition', strength: 'strong' },
  'おまけに':         { role: 'addition', strength: 'medium' },
  'それだけじゃなくて': { role: 'addition', strength: 'strong' },
  'まず':             { role: 'sequence', strength: 'strong' },
  '次に':             { role: 'sequence', strength: 'strong' },
  'それから':         { role: 'sequence', strength: 'medium' },
  '最後に':           { role: 'sequence', strength: 'strong' },
  'まず最初に':       { role: 'sequence', strength: 'strong' },
  '次のステップとして': { role: 'sequence', strength: 'strong' },

  // ── Elaboration / rephrase / summary / example ───────────
  'つまり':           { role: 'rephrasing', strength: 'strong' },
  '要するに':         { role: 'summary', strength: 'strong' },
  '要は':             { role: 'summary', strength: 'medium' },
  'まとめると':       { role: 'summary', strength: 'strong' },
  '簡単に言うと':     { role: 'rephrasing', strength: 'strong' },
  '一言で言うと':     { role: 'rephrasing', strength: 'strong' },
  '端的に言うと':     { role: 'rephrasing', strength: 'strong' },
  '結論から言うと':   { role: 'summary', strength: 'strong' },
  '言い換えると':     { role: 'rephrasing', strength: 'strong' },
  'というか':         { role: 'rephrasing', strength: 'medium' },
  'っていうか':       { role: 'repair', strength: 'medium' },
  'ていうか':         { role: 'repair', strength: 'medium' },
  '例えば':           { role: 'exemplification', strength: 'strong' },
  'たとえばさ':       { role: 'exemplification', strength: 'strong' },
  'いわば':           { role: 'exemplification', strength: 'medium' },
  '逆に言うと':       { role: 'rephrasing', strength: 'medium' },
  'もっと言うと':     { role: 'elaboration', strength: 'medium' },

  // ── Topic management ────────────────────────────────────
  'ところで':         { role: 'topic-shift', strength: 'strong' },
  'そういえば':       { role: 'topic-shift', strength: 'strong' },
  '話変わるけど':     { role: 'topic-shift', strength: 'strong' },
  '余談ですが':       { role: 'topic-shift', strength: 'strong' },
  '余談だけど':       { role: 'topic-shift', strength: 'strong' },
  'それでは':         { role: 'topic-shift', strength: 'medium' },
  'さて':             { role: 'topic-shift', strength: 'medium' },
  'で':               { role: 'topic-shift', strength: 'weak' },
  'で、さっきの':     { role: 'topic-return', strength: 'strong' },
  '話戻すと':         { role: 'topic-return', strength: 'strong' },
  '元に戻ると':       { role: 'topic-return', strength: 'strong' },
  '元の話に戻ると':   { role: 'topic-return', strength: 'strong' },
  'そもそも':         { role: 'topic-initiation', strength: 'strong' },
  '基本的に':         { role: 'topic-initiation', strength: 'medium' },
  '前提として':       { role: 'topic-initiation', strength: 'strong' },
  'ちなみに':         { role: 'topic-shift', strength: 'medium' },

  // ── Hedges (sentence-final) ─────────────────────────────
  'んですけど':       { role: 'hedge', strength: 'medium' },
  'んだけど':         { role: 'hedge', strength: 'medium' },
  'んですけれども':   { role: 'hedge', strength: 'medium' },
  'かもしれない':     { role: 'hedge', strength: 'strong' },
  'かもしれません':   { role: 'hedge', strength: 'strong' },
  'かも':             { role: 'hedge', strength: 'medium' },
  'と思う':           { role: 'hedge', strength: 'medium' },
  'と思います':       { role: 'hedge', strength: 'medium' },
  'と思うんですけど': { role: 'hedge', strength: 'strong' },
  'かなと思って':     { role: 'hedge', strength: 'strong' },
  'なんですけどね':   { role: 'hedge', strength: 'medium' },

  // ── Assertion markers ─────────────────────────────────────
  'んですよ':         { role: 'assertion-marker', strength: 'medium' },
  'のですよ':         { role: 'assertion-marker', strength: 'medium' },
  'んだよ':           { role: 'assertion-marker', strength: 'medium' },
  'なんですよ':       { role: 'assertion-marker', strength: 'strong' },
  'わけです':         { role: 'assertion-marker', strength: 'strong' },
  'わけですよ':       { role: 'assertion-marker', strength: 'strong' },
  'わけなんですよ':   { role: 'assertion-marker', strength: 'strong' },

  // ── Backchannel / agreement / reaction ──────────────────
  'うん':             { role: 'backchannel', strength: 'strong' },
  'うんうんうん':     { role: 'backchannel', strength: 'strong' },
  'はいはいはい':     { role: 'backchannel', strength: 'strong' },
  'そうそうそう':     { role: 'backchannel', strength: 'strong' },
  'そうそうそうそう': { role: 'backchannel', strength: 'strong' },
  'ああ':             { role: 'backchannel', strength: 'medium' },
  'なるほど':         { role: 'agreement', strength: 'strong' },
  'なるほどね':       { role: 'agreement', strength: 'strong' },
  'たしかに':         { role: 'agreement', strength: 'strong' },
  '分かる':           { role: 'agreement', strength: 'strong' },
  'わかるわかる':     { role: 'agreement', strength: 'strong' },
  'わかるわー':       { role: 'agreement', strength: 'strong' },
  'あるある':         { role: 'agreement', strength: 'strong' },
  'それあるよね':     { role: 'agreement', strength: 'strong' },
  'めっちゃわかる':   { role: 'agreement', strength: 'strong' },
  'えー':             { role: 'reaction', strength: 'strong' },
  'へえ':             { role: 'reaction', strength: 'strong' },
  'うそ':             { role: 'reaction', strength: 'strong' },
  'まじで':           { role: 'reaction', strength: 'strong' },
  'マジ':             { role: 'reaction', strength: 'strong' },
  'やば':             { role: 'reaction', strength: 'strong' },
  'やばい':           { role: 'reaction', strength: 'strong' },
  'すごい':           { role: 'reaction', strength: 'strong' },
  'すごいね':         { role: 'reaction', strength: 'strong' },

  // ── Repair ────────────────────────────────────────────────
  'じゃなくて、':     { role: 'repair', strength: 'strong' },

  // ── Fillers ────────────────────────────────────────────────
  'えーと':           { role: 'filler', strength: 'medium' },
  'えっと':           { role: 'filler', strength: 'medium' },
  'あのー':           { role: 'filler', strength: 'medium' },
  'あの':             { role: 'filler', strength: 'medium' },
  'なんか':           { role: 'filler', strength: 'medium' },
  'まあ':             { role: 'filler', strength: 'medium' },
  'うーん':           { role: 'filler', strength: 'medium' },
  'そのー':           { role: 'filler', strength: 'medium' },

  // ── Quotation / evidential ────────────────────────────────
  'と':               { role: 'quotation', strength: 'weak' },
  'って':             { role: 'quotation', strength: 'weak' },
  'という':           { role: 'quotation', strength: 'weak' },
  'っていう':         { role: 'quotation', strength: 'weak' },
  'らしい':           { role: 'evidential', strength: 'medium' },
  'らしいです':       { role: 'evidential', strength: 'medium' },
  'みたい':           { role: 'evidential', strength: 'medium' },
  'みたいです':       { role: 'evidential', strength: 'medium' },
  'そうです':         { role: 'evidential', strength: 'medium' },
  'って言ってた':     { role: 'quotation', strength: 'strong' },
  'って聞いた':       { role: 'quotation', strength: 'strong' },
};

/** Mark every entry. Idempotent: safe to call multiple times. */
function applyRoles(): void {
  for (const p of ALL_PATTERNS as DiscoursePatternDef[]) {
    if (p.discourseRole) continue; // already set
    const m = ROLE_BY_SURFACE[p.surface];
    if (m) {
      p.discourseRole = m.role;
      p.roleStrength = m.strength;
    }
  }
}

applyRoles();

/** Get the effective role for a pattern, falling back to a tag heuristic. */
export function effectiveRole(p: DiscoursePatternDef): DiscourseRole {
  if (p.discourseRole) return p.discourseRole;
  // Heuristic fallback from pragmaticFunction
  const fn = p.pragmaticFunction;
  if (fn === 'contrast') return 'weak-contrast';
  if (fn === 'concession') return 'concession';
  if (fn === 'cause') return 'cause';
  if (fn === 'result') return 'consequence';
  if (fn === 'addition') return 'addition';
  if (fn === 'sequence') return 'sequence';
  if (fn === 'summary') return 'summary';
  if (fn === 'rephrasing') return 'rephrasing';
  if (fn === 'elaboration') return 'elaboration';
  if (fn === 'reaction') return 'reaction';
  if (fn === 'rebuttal' || fn === 'challenge' || fn === 'counter-example') return 'opposition';
  if (fn === 'self-repair' || fn === 'other-repair') return 'repair';
  if (fn === 'topic-shift') return 'topic-shift';
  if (fn === 'topic-return') return 'topic-return';
  if (fn === 'topic-initiation') return 'topic-initiation';
  if (fn === 'topic-close') return 'topic-shift';
  if (fn === 'assertion') return 'assertion-marker';
  if (fn === 'hedge' || fn === 'softening') return 'hedge';
  if (fn === 'evidential' || fn === 'hearsay') return 'evidential';
  if (fn === 'quotation') return 'quotation';
  if (fn === 'agreement') return 'agreement';
  if (fn === 'backchannel') return 'backchannel';
  if (fn === 'disagreement') return 'opposition';
  if (fn === 'surprise' || fn === 'emotional') return 'reaction';
  if (fn === 'filler') return 'filler';
  if (fn === 'attention') return 'attention';
  if (fn === 'confirmation-seeking') return 'interrogative-marker';
  if (fn === 'desire') return 'desire';
  if (fn === 'obligation') return 'obligation';
  return 'other';
}

export function effectiveStrength(p: DiscoursePatternDef): 'strong' | 'medium' | 'weak' {
  return p.roleStrength ?? 'medium';
}
