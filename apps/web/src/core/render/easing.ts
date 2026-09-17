/**
 * Easing curves.
 *
 * Every curve here is a pure function of normalised time in [0,1] and returns
 * [0,1]. No `Math.random`, no wall-clock reads — the same `timeUs` must produce
 * the identical frame in preview and in the exported file.
 */

export type EasingName = 'linear' | 'easeOut' | 'easeInOut' | 'easeOutBack' | 'easeOutExpo' | 'spring';

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function linear(t: number): number {
  return clamp01(t);
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Slight overshoot — used for word activation, where a touch of life reads as intent. */
export function easeOutBack(t: number, overshoot = 1.35): number {
  const x = clamp01(t);
  const c3 = overshoot + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + overshoot * Math.pow(x - 1, 2);
}

export function easeOutExpo(t: number): number {
  const x = clamp01(t);
  return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
}

/** Critically-damped-ish spring; no bounce, just physical settling. */
export function spring(t: number, stiffness = 8, damping = 1): number {
  const x = clamp01(t);
  if (x === 0) return 0;
  return 1 - Math.exp(-stiffness * x) * Math.cos(damping * stiffness * x * 0.35);
}

export function getEasing(name: EasingName): (t: number) => number {
  switch (name) {
    case 'linear':
      return linear;
    case 'easeOut':
      return easeOutCubic;
    case 'easeInOut':
      return easeInOutCubic;
    case 'easeOutBack':
      return easeOutBack;
    case 'easeOutExpo':
      return easeOutExpo;
    case 'spring':
      return spring;
  }
}

/** Deterministic pseudo-noise in [-1,1] from a seed. Drifts must not use random(). */
export function noise1(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Smooth value noise, used for slow ambient drift in backgrounds. */
export function smoothNoise(t: number, seed = 0): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = noise1(i + seed);
  const b = noise1(i + 1 + seed);
  const u = f * f * (3 - 2 * f);
  return a * (1 - u) + b * u;
}

/** Map a value from one range into another, clamped. */
export function remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return outMin;
  const t = clamp01((value - inMin) / (inMax - inMin));
  return outMin + t * (outMax - outMin);
}
