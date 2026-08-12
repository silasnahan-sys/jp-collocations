/**
 * physics.ts — one set of laws, for everything in the app that moves.
 *
 * ## Why this is its own file
 *
 * These functions were written inside `floating-rail.ts`, for the rail. The
 * moment a second thing needed to move — the edge-back affordance — copying
 * them would have been the whole problem in miniature: two surfaces with two
 * slightly different ideas of what resistance feels like is exactly the seam a
 * hand notices and cannot name. 「SEEMLESS INTREGRATION」 is not a feature you
 * add, it is an invariant you refuse to break, and the cheapest way to refuse
 * is to make the alternative impossible to write.
 *
 * So: if it moves under a finger in this plugin, it moves by these functions.
 *
 * ## The three laws
 *
 *   1. In bounds, a thing tracks the finger exactly.
 *   2. Past a bound it RESISTS, asymptotically, and never quite refuses.
 *   3. On release it carries the velocity it had into a critically damped
 *      settle — no overshoot, because you cannot bounce off a wall you are
 *      landing on.
 *
 * Reported against the first version, which broke 1 and 3: 「its a litle bouncy
 * but artificially so」. That was correct. Character applied AT the moment of
 * release, to something rigid and unresisting for the whole gesture before it,
 * reads as decoration — because it is.
 *
 * PURE. No DOM, no Obsidian, no clock. Golden: golden/physics.mjs.
 */

// ── springs ───────────────────────────────────────────────────────────────────

/** A damped spring, in the terms the feel is actually tuned in. */
export interface Spring {
  /** How hard it pulls toward the target. Higher = quicker, tighter. */
  stiffness: number;
  /** How hard it resists moving. Lower = bouncier. */
  damping: number;
  mass: number;
}

/**
 * ζ = 1 exactly, by construction.
 *
 * `damping` is DERIVED and never typed in beside a stiffness. Writing the two
 * numbers independently means the next person to retune the speed silently
 * reintroduces an overshoot, and an overshoot into an edge is the precise thing
 * that read as artificial. Make the mistake unavailable rather than commented.
 */
export const criticallyDamped = (stiffness: number, mass = 1): Spring => ({
  stiffness,
  damping: 2 * Math.sqrt(stiffness * mass),
  mass,
});

/** Below this many px from target the spring is done. */
export const REST_PX = 0.5;
/** A spring that has not settled by here is over-thrown; land it anyway. */
export const MAX_SETTLE_MS = 900;

/**
 * Displacement from the target at time `t` for a spring released at `x0`
 * carrying velocity `v0`. Ends at 0 by construction, which is why every caller
 * animates the DIFFERENCE and never an absolute position.
 *
 * The overdamped case (ζ>1) borrows the critically damped form: neither
 * overshoots, and the difference between them is a fraction of a pixel over the
 * settle. Kept only so a caller that retunes the constants cannot produce NaN.
 */
export function springAt(x0: number, v0: number, t: number, s: Spring): number {
  const w0 = Math.sqrt(s.stiffness / s.mass);
  const zeta = s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const b = (v0 + zeta * w0 * x0) / wd;
    return Math.exp(-zeta * w0 * t) * (x0 * Math.cos(wd * t) + b * Math.sin(wd * t));
  }
  return (x0 + (v0 + w0 * x0) * t) * Math.exp(-w0 * t);
}

export interface SpringFrame { t: number; x: number; y: number }

/**
 * Sample the spring into evenly spaced frames, ready to hand to WAAPI.
 *
 * Even spacing is the point: `element.animate()` distributes keyframes evenly
 * across the duration, so a fixed-rate sample IS the curve — no easing string
 * can express a spring, and none has to.
 *
 * The last frame is forced to exactly the target. A spring that stops 0.3px out
 * leaves the thing permanently off its own edge, and the error compounds
 * because the next gesture starts from there.
 */
export function springFrames(
  dx: number,
  dy: number,
  vx: number,
  vy: number,
  s: Spring,
  fps = 60,
): SpringFrame[] {
  const out: SpringFrame[] = [];
  const maxN = Math.ceil((MAX_SETTLE_MS / 1000) * fps);
  let quiet = 0;
  for (let i = 0; i <= maxN; i++) {
    const t = i / fps;
    const x = springAt(dx, vx, t, s);
    const y = springAt(dy, vy, t, s);
    out.push({ t, x, y });
    // Three consecutive still samples (~50ms) is settled, not a zero crossing
    // on the way through — a single sample under REST_PX happens mid-bounce.
    quiet = Math.abs(x) < REST_PX && Math.abs(y) < REST_PX ? quiet + 1 : 0;
    if (quiet >= 3) break;
  }
  out.push({ t: out.length / fps, x: 0, y: 0 });
  return out;
}

/** Turn a spring into WAAPI keyframes that translate `dx,dy` away to nothing. */
export function springKeyframes(
  dx: number,
  dy: number,
  vx: number,
  vy: number,
  s: Spring,
): { keys: Keyframe[]; ms: number } {
  const frames = springFrames(dx, dy, vx, vy, s);
  return {
    keys: frames.map((f) => ({
      transform: `translate(${f.x.toFixed(2)}px, ${f.y.toFixed(2)}px)`,
    })),
    ms: Math.max(1, frames.length - 1) * (1000 / 60),
  };
}

// ── resistance ────────────────────────────────────────────────────────────────

/**
 * How hard the walls push back. Apple's own constant, and it is worth keeping
 * the same one: this curve is in everything the hand has already been trained
 * on for fifteen years, so matching it is not imitation, it is speaking the
 * dialect the hand already knows.
 */
export const RUBBER = 0.55;

/**
 * Progressive resistance past a bound, instead of a wall.
 *
 * A dead stop under a moving finger is the instant the illusion breaks — your
 * hand keeps going and the object does not, so it stops being an object. Real
 * resistance is asymptotic: the further past the bound you push, the less it
 * gives, and it never quite refuses. You can always feel that you have reached
 * the end WITHOUT being told you have.
 *
 * This is also the one place a bounce is honest: released from beyond a bound,
 * the thing is genuinely out of position, so returning is a real journey rather
 * than a flourish added to an arrival.
 */
export function rubberBand(over: number, dim: number, c = RUBBER): number {
  if (over === 0 || dim <= 0) return 0;
  const sign = over < 0 ? -1 : 1;
  const x = Math.abs(over);
  return sign * (1 - 1 / ((x * c) / dim + 1)) * dim;
}

// ── the throw ─────────────────────────────────────────────────────────────────

export interface Sample { t: number; x: number; y: number }

/**
 * Throw speed, from the tail of the gesture rather than the last frame.
 *
 * One frame's delta is noise — a finger that paused before lifting still
 * reports whatever jitter the digitiser saw last, and a 4px twitch over 16ms is
 * 250px/s of phantom throw. Averaging the last ~90ms gets the speed the hand
 * actually had while it was still moving.
 */
export function throwVelocity(
  trail: readonly Sample[],
  windowMs = 90,
): { vx: number; vy: number } {
  if (trail.length < 2) return { vx: 0, vy: 0 };
  const last = trail[trail.length - 1]!;
  let first = trail[0]!;
  for (const s of trail) { if (last.t - s.t <= windowMs) { first = s; break; } }
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0.001) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

/** Keep a trail bounded without allocating a new array per move. */
export function pushSample(trail: Sample[], s: Sample, cap = 8): void {
  trail.push(s);
  if (trail.length > cap) trail.shift();
}
